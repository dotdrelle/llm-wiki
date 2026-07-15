import { existsSync } from 'node:fs';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
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
import {
  normalizeGeneratedMarkdown,
  parseTemplateInstructions,
} from '../utils/markdown.ts';
import type {
  AppConfig,
  BuildState,
  BuildContext,
  SourceDocument,
  TemplateDocument,
  WikiOperation,
  WikiPage,
  WorkspacePaths,
  AddSkillResult,
  StabilizeDiff,
} from '../types.ts';

const execFileAsync = promisify(execFile);
const SKILL_REQUIRED_PATHS = ['templates', 'build-context', '.wiki/skills'];
const SKILL_INSTALL_PATHS = [
  'templates',
  'build-context',
  '.wiki/skills',
  '.wiki/system-prompt.md',
  'CLAUDE.md',
];
const SKILL_ALLOWED_ROOTS = ['templates/', 'build-context/', '.wiki/skills/'];
const SKILL_ALLOWED_FILES = new Set(['CLAUDE.md', '.wiki/system-prompt.md']);

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const LATIN1_DECODER = new TextDecoder('iso-8859-1');

function decodeBuffer(buffer: Buffer): { text: string; encoding?: 'latin-1' } {
  try {
    return { text: UTF8_DECODER.decode(buffer) };
  } catch {
    return { text: LATIN1_DECODER.decode(buffer), encoding: 'latin-1' };
  }
}

function fallbackTitleFromWikiPath(wikiPath: string): string {
  const fileName = path.basename(wikiPath, path.extname(wikiPath));
  return fileName.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}

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

    await this.writeInitialMcpAccessKey();
  }

  private async writeInitialMcpAccessKey(): Promise<void> {
    const accessKey = process.env.WIKI_MCP_AUTH_TOKEN ?? process.env.WIKI_MCP_ACCESS_KEY;
    if (!accessKey || !(await pathExists(this.paths.configPath))) return;

    const raw = await readFile(this.paths.configPath, 'utf8');
    if (/^\s*accessKey:\s*\S+/m.test(raw)) return;
    const next = raw.replace(
      /^(\s*)#\s*accessKey:\s*your-secret-key\s*$/m,
      `$1accessKey: ${JSON.stringify(accessKey)}`,
    );
    if (next !== raw) {
      await writeFile(this.paths.configPath, next, 'utf8');
    }
  }

  private async prepareSkillSource(
    source: string,
    tmpRoot: string,
  ): Promise<{ sourceDir: string; sourceLabel: string }> {
    if (isUrl(source)) {
      if (!source.toLowerCase().endsWith('.zip')) {
        throw new Error('Remote skill sources must be .zip files.');
      }
      const zipPath = path.join(tmpRoot, 'skill.zip');
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`Failed to download skill: HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(zipPath, buffer);
      return {
        sourceDir: await this.extractSkillZip(zipPath, tmpRoot),
        sourceLabel: source,
      };
    }

    const absoluteSource = path.resolve(source);
    const sourceStats = await stat(absoluteSource).catch(() => undefined);
    if (!sourceStats) {
      throw new Error(`Skill source not found: ${source}`);
    }

    if (sourceStats.isDirectory()) {
      return { sourceDir: absoluteSource, sourceLabel: absoluteSource };
    }

    if (sourceStats.isFile() && absoluteSource.toLowerCase().endsWith('.zip')) {
      return {
        sourceDir: await this.extractSkillZip(absoluteSource, tmpRoot),
        sourceLabel: absoluteSource,
      };
    }

    throw new Error(
      'Skill source must be a directory, a .zip file, or an HTTP(S) .zip URL.',
    );
  }

  private async extractSkillZip(zipPath: string, tmpRoot: string): Promise<string> {
    const listing = await execFileAsync('unzip', ['-Z1', zipPath]).catch(
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to inspect skill zip with unzip: ${message}`);
      },
    );

    const entries = listing.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      throw new Error('Skill zip is empty.');
    }
    for (const entry of entries) {
      assertSafeRelativePath(entry);
    }

    const extractDir = path.join(tmpRoot, 'extract');
    await mkdir(extractDir, { recursive: true });
    await execFileAsync('unzip', ['-q', zipPath, '-d', extractDir]).catch(
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to extract skill zip with unzip: ${message}`);
      },
    );
    return this.findSkillRoot(extractDir);
  }

  private async findSkillRoot(extractDir: string): Promise<string> {
    if (await this.hasSkillLayout(extractDir)) {
      return extractDir;
    }

    const entries = await readdir(extractDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    if (directories.length === 1) {
      const nestedRoot = path.join(extractDir, directories[0].name);
      if (await this.hasSkillLayout(nestedRoot)) {
        return nestedRoot;
      }
    }

    throw new Error(
      'Skill package must contain templates/, build-context/, and .wiki/skills/ at its root.',
    );
  }

  private async hasSkillLayout(root: string): Promise<boolean> {
    return (
      await Promise.all(
        SKILL_REQUIRED_PATHS.map((relativePath) =>
          pathExists(path.join(root, relativePath)),
        ),
      )
    ).every(Boolean);
  }

  private async validateSkillSource(sourceDir: string): Promise<void> {
    const root = await this.findSkillRoot(sourceDir);
    for (const requiredPath of SKILL_REQUIRED_PATHS) {
      if (!(await pathExists(path.join(root, requiredPath)))) {
        throw new Error(`Skill package is missing required path: ${requiredPath}`);
      }
    }

    const paths = await scanSkillTree(root);
    for (const relativePath of paths) {
      assertAllowedSkillPath(relativePath);
    }
  }

  async addSkill(source: string): Promise<AddSkillResult> {
    await this.ensureInitialized();
    const runId = `add-skill-${timestampForPath()}`;
    const tmpRoot = path.join(this.paths.internalDir, 'tmp', runId);
    const backupDir = path.join(tmpRoot, 'backup');
    await mkdir(tmpRoot, { recursive: true });

    const prepared = await this.prepareSkillSource(source, tmpRoot);
    const sourceRoot = await this.findSkillRoot(prepared.sourceDir);
    await this.validateSkillSource(sourceRoot);
    const installPaths: string[] = [];
    for (const relativePath of SKILL_INSTALL_PATHS) {
      if (await pathExists(path.join(sourceRoot, relativePath))) {
        installPaths.push(relativePath);
      }
    }

    const backupTargets: string[] = [];
    for (const relativePath of installPaths) {
      const target = path.join(this.paths.rootDir, relativePath);
      if (await pathExists(target)) {
        const backupTarget = path.join(backupDir, relativePath);
        await mkdir(path.dirname(backupTarget), { recursive: true });
        await cp(target, backupTarget, { recursive: true, force: true });
        backupTargets.push(relativePath);
      }
    }

    const installed: string[] = [];
    for (const relativePath of installPaths) {
      const target = path.join(this.paths.rootDir, relativePath);
      await removeIfExists(target);
      const sourcePath = path.join(sourceRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(sourcePath, target, { recursive: true, force: true });
      installed.push(relativePath);
    }

    const installState = {
      source: prepared.sourceLabel,
      installedAt: new Date().toISOString(),
      backupDir: relativeFrom(this.paths.rootDir, backupDir),
      backupTargets,
      installed,
    };
    await safeWriteFile(
      path.join(this.paths.internalDir, 'skill-install.json'),
      `${JSON.stringify(installState, null, 2)}\n`,
    );
    await this.appendLog('add-skill', installState.source);

    return {
      source: prepared.sourceLabel,
      backupDir: installState.backupDir,
      installed,
    };
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

  resolveUntrackedSourceTarget(input: { name: string; subdir?: string }): {
    absolutePath: string;
    relativePath: string;
    fileName: string;
  } {
    const normalizedName = input.name.trim().replace(/\.md$/i, '');
    if (!normalizedName || /[\\/]/.test(normalizedName)) {
      throw new Error(
        'Source name must be a non-empty logical name without path separators.',
      );
    }
    const slug = slugify(normalizedName);
    if (!slug) throw new Error('Source name must contain at least one letter or number.');
    const nameHash = hashText(normalizedName).slice(0, 16);
    const fileName = `${slug.slice(0, 55)}-${nameHash}.md`;

    const rawSubdir = input.subdir?.trim() ?? '';
    let safeSubdir = '';
    if (rawSubdir) {
      const normalizedSubdir = rawSubdir.replace(/\\/g, '/');
      if (
        path.isAbsolute(normalizedSubdir) ||
        /^[a-zA-Z]:\//.test(normalizedSubdir) ||
        normalizedSubdir.split('/').some((part) => !part || part === '.' || part === '..')
      ) {
        throw new Error('Source subdirectory must be a safe relative path.');
      }
      const safeParts = normalizedSubdir.split('/').map((part) => slugify(part));
      if (safeParts.some((part) => !part)) {
        throw new Error('Source subdirectory must contain only non-empty path segments.');
      }
      safeSubdir = safeParts.join(path.sep);
    }

    const absolutePath = resolveInside(
      this.paths.rawUntrackedDir,
      safeSubdir ? path.join(safeSubdir, fileName) : fileName,
    );
    const relativeToUntracked = path.relative(this.paths.rawUntrackedDir, absolutePath);
    if (
      relativeToUntracked.startsWith('..') ||
      path.isAbsolute(relativeToUntracked) ||
      path.extname(absolutePath).toLowerCase() !== '.md'
    ) {
      throw new Error('Source target must stay inside the workspace ingestion inbox.');
    }
    return {
      absolutePath,
      relativePath: relativeFrom(this.paths.rootDir, absolutePath),
      fileName,
    };
  }

  async inspectUntrackedSource(input: { name: string; subdir?: string }): Promise<{
    absolutePath: string;
    relativePath: string;
    existed: boolean;
    content: string;
  }> {
    const target = this.resolveUntrackedSourceTarget(input);
    const existed = await pathExists(target.absolutePath);
    return {
      ...target,
      existed,
      content: existed ? await readFile(target.absolutePath, 'utf8') : '',
    };
  }

  async writeUntrackedSource(input: {
    name: string;
    content: string;
    subdir?: string;
    overwrite?: boolean;
  }): Promise<{
    relativePath: string;
    absolutePath: string;
    bytes: number;
    overwritten: boolean;
  }> {
    const target = this.resolveUntrackedSourceTarget(input);
    await mkdir(path.dirname(target.absolutePath), { recursive: true });
    const overwritten = await pathExists(target.absolutePath);
    if (input.overwrite === true) {
      await safeWriteFile(target.absolutePath, input.content);
    } else {
      try {
        await writeFile(target.absolutePath, input.content, {
          encoding: 'utf8',
          flag: 'wx',
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const collision = new Error(`Source already exists: ${target.relativePath}`);
          (collision as NodeJS.ErrnoException).code = 'SOURCE_ALREADY_EXISTS';
          throw collision;
        }
        throw error;
      }
    }
    return {
      absolutePath: target.absolutePath,
      relativePath: target.relativePath,
      bytes: Buffer.byteLength(input.content, 'utf8'),
      overwritten,
    };
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
    const buffer = await readFile(absolutePath);
    const { text: rawContent, encoding: detectedEncoding } = decodeBuffer(buffer);
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
      rawByteLength: buffer.byteLength,
      ...(detectedEncoding && { detectedEncoding }),
    };
  }

  async isSourceUnchangedSinceIngest(source: SourceDocument): Promise<boolean> {
    const archivedPath = path.join(this.paths.rootDir, source.archiveRelativePath);
    if (!(await pathExists(archivedPath))) {
      return false;
    }
    const archivedStats = await stat(archivedPath);
    const expectedByteLength =
      source.rawByteLength ?? Buffer.byteLength(source.rawContent, 'utf8');
    if (archivedStats.size !== expectedByteLength) {
      return false;
    }
    const archivedBuffer = await readFile(archivedPath);
    const { text: archivedContent } = decodeBuffer(archivedBuffer);
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
            await writeIfChanged(
              absolutePath,
              normalizeGeneratedMarkdown(
                operation.content ?? '',
                fallbackTitleFromWikiPath(operation.path),
              ),
            );
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
    return writeIfChanged(outputAbsolutePath, normalizeGeneratedMarkdown(content));
  }

  async readDeliverableIfExists(outputAbsolutePath: string): Promise<string | null> {
    const absolutePath = resolveInside(
      this.paths.rootDir,
      relativeFrom(this.paths.rootDir, outputAbsolutePath),
    );
    if (!(await pathExists(absolutePath))) return null;
    return readFile(absolutePath, 'utf8');
  }

  deriveTmpDeliverablePath(outputAbsolutePath: string): string {
    const absolutePath = resolveInside(
      this.paths.rootDir,
      relativeFrom(this.paths.rootDir, outputAbsolutePath),
    );
    const parsed = path.parse(absolutePath);
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const shortId = hashText(`${absolutePath}:${stamp}:${Math.random()}`).slice(0, 8);
    return path.join(parsed.dir, `.tmp.${parsed.name}.${stamp}_${shortId}${parsed.ext}`);
  }

  deriveChangesSidecarPath(outputAbsolutePath: string): string {
    const absolutePath = resolveInside(
      this.paths.rootDir,
      relativeFrom(this.paths.rootDir, outputAbsolutePath),
    );
    const parsed = path.parse(absolutePath);
    return path.join(parsed.dir, `.changes.${parsed.name}${parsed.ext}.json`);
  }

  async writeChangesSidecar(
    outputAbsolutePath: string,
    diff: StabilizeDiff,
  ): Promise<void> {
    const sidecarPath = this.deriveChangesSidecarPath(outputAbsolutePath);
    await safeWriteFile(
      sidecarPath,
      `${JSON.stringify({ stabilizedAt: new Date().toISOString(), ...diff }, null, 2)}\n`,
    );
  }

  async deleteChangesSidecarIfExists(outputAbsolutePath: string): Promise<void> {
    await rm(this.deriveChangesSidecarPath(outputAbsolutePath), { force: true });
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
    return files
      .filter(
        (file) =>
          !relativeFrom(this.paths.deliverablesDir, file)
            .split('/')
            .some((part) => part.startsWith('.tmp.') || part.startsWith('.changes.')),
      )
      .sort();
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

  async loadProfileSection(maxProfileChars: number): Promise<string> {
    const profilePath = path.join(this.paths.internalDir, 'profile.md');
    if (!(await pathExists(profilePath))) {
      return '';
    }
    const content = (await readFile(profilePath, 'utf8')).trim();
    if (!content) return '';

    const header = `## Workspace Profile

The workspace profile is stored in \`.wiki/profile.md\`, next to the workspace system prompt.
Use it to adapt your behavior to the user and the workspace.
When the user asks to remember, persist, summarize, or update durable profile-related information, update \`.wiki/profile.md\` via the profile_update tool.
Keep the profile concise. If it becomes too long, summarize it into the \`## Summary\` section.
Do not store secrets, credentials, API keys, passwords, temporary facts, or unnecessary private information.`;

    if (content.length <= maxProfileChars) {
      return `${header}\n\n${content}`;
    }

    const summaryMatch = /^## Summary\s*\n([\s\S]*?)(?=\n## |\s*$)/m.exec(content);
    if (summaryMatch) {
      const summary = summaryMatch[1].trim();
      return `${header}\n\n## Summary\n\n${summary}`;
    }

    return `${header}\n\n[Profile exceeds maxProfileChars limit and has no ## Summary section. Ask the user to summarize \`.wiki/profile.md\` into the ## Summary section.]`;
  }
}

function timestampForPath(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeSkillRelativePath(value: string): string {
  return value
    .split(path.sep)
    .join('/')
    .replace(/^\.\/+/, '');
}

function assertSafeRelativePath(relativePath: string): void {
  const normalized = normalizeSkillRelativePath(relativePath);
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Unsafe skill package path: ${relativePath}`);
  }
}

function assertAllowedSkillPath(relativePath: string): void {
  const normalized = normalizeSkillRelativePath(relativePath);
  assertSafeRelativePath(normalized);
  if (SKILL_ALLOWED_FILES.has(normalized)) return;
  if (SKILL_ALLOWED_ROOTS.some((prefix) => normalized.startsWith(prefix))) return;
  if (
    normalized === '.wiki' ||
    normalized === '.wiki/skills' ||
    normalized === 'templates' ||
    normalized === 'build-context'
  ) {
    return;
  }
  throw new Error(`Unexpected path in skill package: ${relativePath}`);
}

async function scanSkillTree(rootDir: string, relativeDir = ''): Promise<string[]> {
  const dir = path.join(rootDir, relativeDir);
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const relativePath = normalizeSkillRelativePath(path.join(relativeDir, entry.name));
    assertSafeRelativePath(relativePath);
    const absolutePath = path.join(rootDir, relativePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in skill packages: ${relativePath}`);
    }
    paths.push(relativePath);
    if (entry.isDirectory()) {
      paths.push(...(await scanSkillTree(rootDir, relativePath)));
    }
  }
  return paths;
}
