import { mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { pathExists, safeWriteFile } from '../utils/fs.ts';
import { resolveInside, slugify } from '../utils/path.ts';
import type { WorkspaceService } from './workspaceService.ts';

export interface ConceptGroupMove {
  source: string;
  target: string;
  group: string;
}

export interface ConceptGroupSkip {
  path: string;
  reason: string;
}

export interface ConceptGroupPlan {
  moves: ConceptGroupMove[];
  skipped: ConceptGroupSkip[];
}

export class ConceptGroupingService {
  private readonly workspace: WorkspaceService;
  constructor(workspace: WorkspaceService) {
    this.workspace = workspace;
  }

  async plan(): Promise<ConceptGroupPlan> {
    await this.workspace.ensureInitialized();
    const pages = await this.workspace.listWikiPages();
    const moves: ConceptGroupMove[] = [];
    const skipped: ConceptGroupSkip[] = [];

    for (const page of pages.filter((candidate) => candidate.type === 'concept')) {
      const relative = page.relativePath;
      const withinConcepts = relative.replace(/^wiki\/concepts\//, '');
      if (withinConcepts.includes('/')) {
        skipped.push({ path: relative, reason: 'already nested' });
        continue;
      }

      const parsed = matter(page.content);
      const group = typeof parsed.data.group === 'string' ? parsed.data.group.trim() : '';
      if (!group) {
        skipped.push({ path: relative, reason: 'missing frontmatter group' });
        continue;
      }

      const groupSlug = slugify(group);
      if (!groupSlug) {
        skipped.push({ path: relative, reason: 'invalid group slug' });
        continue;
      }

      const target = `wiki/concepts/${groupSlug}/${path.basename(relative)}`;
      if (target === relative) {
        skipped.push({ path: relative, reason: 'already at target' });
        continue;
      }
      if (await pathExists(resolveInside(this.workspace.paths.rootDir, target))) {
        skipped.push({ path: relative, reason: `target exists: ${target}` });
        continue;
      }

      moves.push({ source: relative, target, group });
    }

    return { moves, skipped };
  }

  async apply(plan?: ConceptGroupPlan): Promise<ConceptGroupPlan> {
    const resolvedPlan = plan ?? (await this.plan());
    for (const move of resolvedPlan.moves) {
      const source = resolveInside(this.workspace.paths.rootDir, move.source);
      const target = resolveInside(this.workspace.paths.rootDir, move.target);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(source, target);
    }

    if (resolvedPlan.moves.length) {
      await this.rewriteWikiLinks(resolvedPlan.moves);
    }

    return resolvedPlan;
  }

  private async rewriteWikiLinks(moves: ConceptGroupMove[]): Promise<void> {
    const pages = await this.workspace.listWikiPages();
    for (const page of pages) {
      let content = await readFile(page.absolutePath, 'utf8');
      const before = content;
      for (const move of moves) {
        const sourceNoWiki = move.source.replace(/^wiki\//, '');
        const targetNoWiki = move.target.replace(/^wiki\//, '');
        content = content
          .replaceAll(move.source, move.target)
          .replaceAll(sourceNoWiki, targetNoWiki);
      }
      if (content !== before) {
        await safeWriteFile(page.absolutePath, content);
      }
    }
  }
}

export function formatConceptGroupPlan(plan: ConceptGroupPlan): string {
  const lines = [
    `Concept grouping plan: ${plan.moves.length} move(s), ${plan.skipped.length} skipped.`,
  ];
  for (const move of plan.moves) {
    lines.push(`  move ${move.source} -> ${move.target} (${move.group})`);
  }
  const actionableSkips = plan.skipped.filter((skip) => skip.reason !== 'already nested');
  if (actionableSkips.length) {
    lines.push('Skipped:');
    for (const skip of actionableSkips) {
      lines.push(`  - ${skip.path}: ${skip.reason}`);
    }
  }
  return lines.join('\n');
}
