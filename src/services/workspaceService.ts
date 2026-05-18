import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { buildStateSchema } from '../config/schema.ts';
import {
  removeIfExists,
  safeWriteFile,
  writeIfChanged,
  pathExists,
} from '../utils/fs.ts';
import { hashParts, hashText } from '../utils/hash.ts';
import {
  canonicalizeName,
  relativeFrom,
  resolveInside,
  slugify,
  slugifyPath,
} from '../utils/path.ts';
import { parseTemplateInstructions } from '../utils/markdown.ts';
import type {
  AppConfig,
  BuildState,
  BuildContext,
  SourceDocument,
  TemplateDocument,
  WikiOperation,
  WikiPage,
  WorkspacePaths,
} from '../types.ts';

function inferWikiPageType(relativePath: string): WikiPage['type'] {
  if (relativePath === 'wiki/index.md') {
    return 'index';
  }
  if (relativePath.startsWith('wiki/concepts/')) {
    return 'concept';
  }
  if (relativePath.startsWith('wiki/sources/')) {
    return 'source';
  }
  if (relativePath.startsWith('wiki/answers/')) {
    return 'answer';
  }
  return 'other';
}

export class WorkspaceService {
  readonly paths: WorkspacePaths;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    const rootDir = path.resolve(config.wikiRoot);
    this.paths = {
      rootDir,
      configPath: path.join(rootDir, '.wikirc.yaml'),
      gitignorePath: path.join(rootDir, '.gitignore'),
      claudePath: path.join(rootDir, 'CLAUDE.md'),
      internalDir: path.join(rootDir, '.wiki'),
      logsDir: path.join(rootDir, '.wiki', 'logs'),
      cacheDir: path.join(rootDir, '.wiki', 'cache'),
      queryEmbeddingCacheDir: path.join(rootDir, '.wiki', 'cache', 'query-embeddings'),
      rerankCacheDir: path.join(rootDir, '.wiki', 'cache', 'rerank'),
      buildStatePath: path.join(rootDir, '.wiki', 'build-state.json'),
      rawDir: path.join(rootDir, 'raw'),
      rawUntrackedDir: path.join(rootDir, 'raw', 'untracked'),
      rawIngestedDir: path.join(rootDir, 'raw', 'ingested'),
      vectorIndexDir: path.join(rootDir, '.wiki', 'vector-index'),
      wikiDir: path.join(rootDir, 'wiki'),
      wikiIndexPath: path.join(rootDir, 'wiki', 'index.md'),
      wikiLogPath: path.join(rootDir, 'wiki', 'log.md'),
      wikiConceptsDir: path.join(rootDir, 'wiki', 'concepts'),
      wikiSourcesDir: path.join(rootDir, 'wiki', 'sources'),
      wikiAnswersDir: path.join(rootDir, 'wiki', 'answers'),
      templatesDir: path.join(rootDir, 'templates'),
      buildContextDir: path.join(rootDir, 'build-context'),
      deliverablesDir: path.join(rootDir, 'deliverables'),
    };
  }

  private getScaffoldDir(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(currentDir, '../scaffold/workspace'),
      path.resolve(currentDir, '../../scaffold/workspace'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  }

  async ensureInitialized(): Promise<void> {
    if (!(await pathExists(this.paths.wikiIndexPath))) {
      throw new Error(
        `Workspace not initialized at ${this.paths.rootDir}. Run "wiki init" first.`,
      );
    }
  }

  async initWorkspace(options: { force?: boolean }): Promise<void> {
    const scaffoldDir = this.getScaffoldDir();
    const entries = await fg(['**/*', '**/.*'], {
      cwd: scaffoldDir,
      dot: true,
      onlyFiles: true,
      ignore: ['**/.DS_Store', '**/Thumbs.db'],
    });

    if (entries.length === 0) {
      throw new Error(`Workspace scaffold is missing or empty at ${scaffoldDir}.`);
    }

    await mkdir(this.paths.rootDir, { recursive: true });

    for (const relativePath of entries) {
      const from = path.join(scaffoldDir, relativePath);
      const to = path.join(this.paths.rootDir, relativePath);
      if (!options.force && (await pathExists(to))) continue;
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
    }
  }

  async appendLog(action: string, details: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const line = `- ${timestamp} | ${action} | ${details}\n`;
    const current = (await pathExists(this.paths.wikiLogPath))
      ? await readFile(this.paths.wikiLogPath, 'utf8')
      : '# Wiki Log\n\n';
    await safeWriteFile(this.paths.wikiLogPath, `${current}${line}`);
  }

  async listUntrackedSourcePaths(): Promise<string[]> {
    const files = await fg('**/*.md', {
      cwd: this.paths.rawUntrackedDir,
      absolute: true,
    });
    return files.sort();
  }

  async resolveSourceInputs(inputs: string[]): Promise<string[]> {
    if (inputs.length === 0) {
      return this.listUntrackedSourcePaths();
    }

    const resolved: string[] = [];
    for (const input of inputs) {
      const candidates = [
        resolveInside(this.paths.rootDir, input),
        resolveInside(this.paths.rawUntrackedDir, input),
      ];

      const found = await Promise.all(
        candidates.map(async (candidate) => ({
          candidate,
          exists: await pathExists(candidate),
        })),
      );

      const match = found.find((entry) => entry.exists);
      if (!match) {
        throw new Error(`Source file not found: ${input}`);
      }

      const relativeToUntracked = path.relative(
        this.paths.rawUntrackedDir,
        match.candidate,
      );
      if (
        relativeToUntracked.startsWith('..') ||
        path.isAbsolute(relativeToUntracked) ||
        !match.candidate.endsWith('.md')
      ) {
        throw new Error(
          `Source must live under raw/untracked and end with .md: ${input}`,
        );
      }

      resolved.push(match.candidate);
    }

    return resolved;
  }

  async readSourceDocument(sourcePath: string): Promise<SourceDocument> {
    const absolutePath = path.resolve(sourcePath);
    const rawContent = await readFile(absolutePath, 'utf8');
    const parsed = matter(rawContent);
    const relativePath = relativeFrom(this.paths.rootDir, absolutePath);
    const relativeToUntracked = relativeFrom(this.paths.rawUntrackedDir, absolutePath);
    const archiveRelativePath = `raw/ingested/${slugifyPath(relativeToUntracked)}`;
    const fileName = path.basename(absolutePath);
    const title =
      typeof parsed.data.title === 'string' && parsed.data.title.trim()
        ? parsed.data.title.trim()
        : path.basename(fileName, '.md');

    return {
      absolutePath,
      relativePath,
      archiveRelativePath,
      archiveCitationPath: archiveRelativePath,
      fileName,
      slug: slugify(title || fileName),
      title,
      frontmatter: parsed.data,
      rawContent,
      body: parsed.content.trim(),
    };
  }

  async isSourceUnchangedSinceIngest(source: SourceDocument): Promise<boolean> {
    const archivedPath = path.join(this.paths.rootDir, source.archiveRelativePath);
    if (!(await pathExists(archivedPath))) {
      return false;
    }
    const archivedStats = await stat(archivedPath);
    if (archivedStats.size !== Buffer.byteLength(source.rawContent, 'utf8')) {
      return false;
    }
    const archivedContent = await readFile(archivedPath, 'utf8');
    return archivedContent === source.rawContent;
  }

  async archiveSource(source: SourceDocument): Promise<void> {
    const destination = path.join(this.paths.rootDir, source.archiveRelativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source.absolutePath, destination);
  }

  async readIndex(): Promise<string> {
    if (!(await pathExists(this.paths.wikiIndexPath))) {
      return '# Wiki Index\n\n';
    }
    return readFile(this.paths.wikiIndexPath, 'utf8');
  }

  async listWikiPages(
    onPage?: (relativePath: string, index: number, total: number) => void,
  ): Promise<WikiPage[]> {
    const files = (
      await fg('**/*.md', {
        cwd: this.paths.wikiDir,
        absolute: true,
      })
    ).sort();

    const pages: WikiPage[] = [];
    for (let i = 0; i < files.length; i++) {
      const absolutePath = files[i];
      const relativePath = relativeFrom(this.paths.rootDir, absolutePath);
      const content = await readFile(absolutePath, 'utf8');
      onPage?.(relativePath, i, files.length);
      pages.push({
        absolutePath,
        relativePath,
        name: path.basename(absolutePath, '.md'),
        type: inferWikiPageType(relativePath),
        content,
      });
    }

    return pages;
  }

  async listIngestedSourcePages(): Promise<WikiPage[]> {
    const files = await fg('**/*.md', {
      cwd: this.paths.rawIngestedDir,
      absolute: true,
    });

    const pages: WikiPage[] = [];
    for (const absolutePath of files.sort()) {
      const relativePath = relativeFrom(this.paths.rootDir, absolutePath);
      pages.push({
        absolutePath,
        relativePath,
        name: path.basename(absolutePath, '.md'),
        type: 'source',
        content: await readFile(absolutePath, 'utf8'),
      });
    }

    return pages;
  }

  async normalizeWikiOperations(operations: WikiOperation[]): Promise<WikiOperation[]> {
    const pages = await this.listWikiPages();
    const basenames = new Map<string, string[]>();

    for (const page of pages) {
      const basename = path.basename(page.relativePath);
      const entries = basenames.get(basename) ?? [];
      entries.push(page.relativePath);
      basenames.set(basename, entries);
    }

    return operations.map((operation) => {
      const rawPath = operation.path.trim().replace(/\\/g, '/').replace(/^\.\//, '');

      if (rawPath.startsWith('wiki/')) {
        return {
          ...operation,
          path: rawPath,
        };
      }

      if (rawPath === 'index.md' || rawPath === 'log.md') {
        return {
          ...operation,
          path: `wiki/${rawPath}`,
        };
      }

      if (
        rawPath.startsWith('concepts/') ||
        rawPath.startsWith('sources/') ||
        rawPath.startsWith('answers/')
      ) {
        return {
          ...operation,
          path: `wiki/${rawPath}`,
        };
      }

      if (!rawPath.includes('/') && rawPath.endsWith('.md')) {
        const matches = basenames.get(rawPath) ?? [];
        if (matches.length === 1) {
          return {
            ...operation,
            path: matches[0],
          };
        }
      }

      throw new Error(
        `Ambiguous or invalid wiki path returned by the model: ${operation.path}. Expected a full wiki/... path or a basename matching exactly one existing wiki page.`,
      );
    });
  }

  private async applyWikiOperationsAtomic(operations: WikiOperation[]): Promise<void> {
    const snapshots = new Map<
      string,
      { absolutePath: string; existed: boolean; content?: string }
    >();

    for (const operation of operations) {
      if (!operation.path.startsWith('wiki/')) {
        throw new Error(`Only wiki/* paths are allowed during ingest: ${operation.path}`);
      }

      if (operation.type !== 'delete' && typeof operation.content !== 'string') {
        throw new Error(`Operation ${operation.path} requires content.`);
      }

      const absolutePath = resolveInside(
        this.paths.wikiDir,
        operation.path.slice('wiki/'.length),
      );
      if (!snapshots.has(absolutePath)) {
        const existed = await pathExists(absolutePath);
        snapshots.set(absolutePath, {
          absolutePath,
          existed,
          ...(existed ? { content: await readFile(absolutePath, 'utf8') } : {}),
        });
      }
    }

    try {
      for (const operation of operations) {
        const absolutePath = resolveInside(
          this.paths.wikiDir,
          operation.path.slice('wiki/'.length),
        );

        switch (operation.type) {
          case 'create':
          case 'update':
            await writeIfChanged(absolutePath, operation.content ?? '');
            break;
          case 'delete':
            await removeIfExists(absolutePath);
            break;
        }
      }
    } catch (error) {
      for (const snapshot of [...snapshots.values()].reverse()) {
        if (snapshot.existed) {
          await safeWriteFile(snapshot.absolutePath, snapshot.content ?? '');
        } else {
          await removeIfExists(snapshot.absolutePath);
        }
      }
      throw error;
    }
  }

  async applyWikiOperations(operations: WikiOperation[]): Promise<void> {
    await this.applyWikiOperationsAtomic(await this.normalizeWikiOperations(operations));
  }

  async applyNormalizedWikiOperations(operations: WikiOperation[]): Promise<void> {
    await this.applyWikiOperationsAtomic(operations);
  }

  async listTemplatePaths(): Promise<string[]> {
    const files = await fg('**/*.md', {
      cwd: this.paths.templatesDir,
      absolute: true,
    });
    return files.sort();
  }

  async resolveTemplateInputs(inputs: string[]): Promise<string[]> {
    if (inputs.length === 0) {
      return this.listTemplatePaths();
    }

    const resolved: string[] = [];
    for (const input of inputs) {
      const candidates = [
        resolveInside(this.paths.rootDir, input),
        resolveInside(this.paths.templatesDir, input),
      ];

      let match: string | undefined;
      for (const candidate of candidates) {
        if (await pathExists(candidate)) {
          match = candidate;
          break;
        }
      }

      if (!match) {
        throw new Error(`Template not found: ${input}`);
      }

      resolved.push(match);
    }

    return resolved;
  }

  async readTemplateDocument(templatePath: string): Promise<TemplateDocument> {
    const absolutePath = resolveInside(
      this.paths.rootDir,
      relativeFrom(this.paths.rootDir, templatePath),
    );
    const rawContent = await readFile(absolutePath, 'utf8');
    const parsed = matter(rawContent);
    const relativePath = relativeFrom(this.paths.rootDir, absolutePath);
    const relativeWithinTemplates = relativeFrom(this.paths.templatesDir, absolutePath);
    const configuredOutput =
      typeof parsed.data.output === 'string' && parsed.data.output.trim()
        ? parsed.data.output.trim()
        : relativeWithinTemplates;
    const outputAbsolutePath = resolveInside(
      this.paths.deliverablesDir,
      configuredOutput,
    );
    const outputRelativePath = relativeFrom(this.paths.rootDir, outputAbsolutePath);

    return {
      absolutePath,
      relativePath,
      frontmatter: parsed.data,
      content: parsed.content.trim(),
      instructions: parseTemplateInstructions(parsed.content),
      outputRelativePath,
      outputAbsolutePath,
    };
  }

  async readBuildContext(): Promise<BuildContext> {
    if (!(await pathExists(this.paths.buildContextDir))) {
      return {
        content: '',
        hash: hashText(''),
        fileCount: 0,
        truncated: false,
        rawTotalChars: 0,
      };
    }

    const files = (
      await fg('**/*.md', {
        cwd: this.paths.buildContextDir,
        absolute: true,
        onlyFiles: true,
      })
    ).sort();

    const maxChars = this.config.build.maxBuildContextChars;
    const sections: string[] = [];
    let totalChars = 0;
    let rawTotalChars = 0;
    let truncated = false;

    for (const absolutePath of files) {
      const relativePath = relativeFrom(this.paths.rootDir, absolutePath);
      const rawContent = await readFile(absolutePath, 'utf8');
      const sectionPrefix = `## ${relativePath}\n\n`;
      const section = `${sectionPrefix}${rawContent.trim()}\n`;
      rawTotalChars += section.length;

      if (!truncated) {
        const remainingChars = maxChars - totalChars;
        if (remainingChars <= 0) {
          truncated = true;
        } else if (section.length > remainingChars) {
          sections.push(section.slice(0, remainingChars).trimEnd());
          totalChars = maxChars;
          truncated = true;
        } else {
          sections.push(section);
          totalChars += section.length;
        }
      }
    }

    const content = sections.join('\n').trim();
    return {
      content,
      hash: hashText(content),
      fileCount: files.length,
      truncated,
      rawTotalChars,
    };
  }

  async writeDeliverable(outputAbsolutePath: string, content: string): Promise<boolean> {
    return writeIfChanged(outputAbsolutePath, content);
  }

  async writeAnswer(question: string, content: string): Promise<string> {
    const slug = slugify(question.slice(0, 80));
    const absolutePath = path.join(this.paths.wikiAnswersDir, `${slug}.md`);
    await mkdir(this.paths.wikiAnswersDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const fileContent = matter.stringify(content, { question, date });
    await safeWriteFile(absolutePath, fileContent);
    return relativeFrom(this.paths.rootDir, absolutePath);
  }

  async listDeliverablePaths(): Promise<string[]> {
    const files = await fg('**/*.md', {
      cwd: this.paths.deliverablesDir,
      absolute: true,
    });
    return files.sort();
  }

  async readTextFile(absolutePath: string): Promise<string> {
    return readFile(absolutePath, 'utf8');
  }

  async readBuildState(): Promise<BuildState> {
    if (!(await pathExists(this.paths.buildStatePath))) {
      return { deliverables: {} };
    }

    const raw = await readFile(this.paths.buildStatePath, 'utf8');
    return buildStateSchema.parse(JSON.parse(raw));
  }

  async writeBuildState(state: BuildState): Promise<void> {
    await mkdir(this.paths.internalDir, { recursive: true });
    await safeWriteFile(this.paths.buildStatePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  async computeWikiHash(pages?: WikiPage[]): Promise<string> {
    const resolvedPages = pages ?? (await this.listWikiPages());
    return hashParts(
      resolvedPages
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        .map((page) => `${page.relativePath}\n${page.content}`),
    );
  }

  async computeTemplateHash(template: TemplateDocument): Promise<string> {
    return hashText(
      JSON.stringify({
        frontmatter: template.frontmatter,
        content: template.content,
        outputRelativePath: template.outputRelativePath,
      }),
    );
  }

  findPageByWikiLink(pages: WikiPage[], target: string): WikiPage | undefined {
    const canonicalTarget = canonicalizeName(target);
    return pages.find((page) => canonicalizeName(page.name) === canonicalTarget);
  }
}
