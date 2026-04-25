import matter from 'gray-matter';
import type { DeliverableReplacement, TemplateInstruction } from '../types.ts';

export interface MarkdownChunk {
  headingPath: string[];
  heading: string;
  content: string;
}

export function splitByHeadings(content: string, maxLevel = 3): MarkdownChunk[] {
  const lines = content.split('\n');
  const chunks: MarkdownChunk[] = [];
  const headingStack: Array<{ depth: number; title: string }> = [];
  let currentLines: string[] = [];
  let inFence = false;

  function flush() {
    const text = currentLines.join('\n').trim();
    if (text.length > 0) {
      chunks.push({
        headingPath: headingStack.map((h) => h.title),
        heading: headingStack.at(-1)?.title ?? '',
        content: text,
      });
    }
  }

  for (const line of lines) {
    if (/^`{3,}/.test(line.trim())) {
      inFence = !inFence;
    }

    const headingMatch = !inFence ? /^(#{1,6})\s+(.+?)\s*$/.exec(line) : null;
    if (headingMatch && headingMatch[1].length <= maxLevel) {
      flush();
      currentLines = [line];
      const depth = headingMatch[1].length;
      const title = headingMatch[2];
      while (headingStack.length > 0 && headingStack.at(-1)!.depth >= depth) {
        headingStack.pop();
      }
      headingStack.push({ depth, title });
    } else {
      currentLines.push(line);
    }
  }

  flush();
  return chunks.length > 0 ? chunks : [{ headingPath: [], heading: '', content: content.trim() }];
}

export function extractWikiLinks(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((match) =>
    match[1].trim(),
  );
}

export function extractSourceCitations(content: string): string[] {
  return [...content.matchAll(/\[src:\s*([^\]]+)\]/gi)].map((match) => match[1].trim());
}

function headingPathAtIndex(content: string, index: number): string[] {
  const lines = content.slice(0, index).split('\n');
  const stack: Array<{ depth: number; title: string }> = [];

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const depth = match[1].length;
    const title = match[2];
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    stack.push({ depth, title });
  }

  return stack.map((entry) => entry.title);
}

export function parseTemplateInstructions(content: string): TemplateInstruction[] {
  const instructions: TemplateInstruction[] = [];
  const pattern = /\[\[INSTRUCTION:\s*([\s\S]*?)\]\]/g;
  let match: RegExpExecArray | null;
  let counter = 1;

  while ((match = pattern.exec(content)) !== null) {
    const surroundingText = content.slice(
      Math.max(0, match.index - 180),
      Math.min(content.length, match.index + match[0].length + 180),
    );

    instructions.push({
      id: `instruction-${counter}`,
      token: match[0],
      instruction: match[1].trim(),
      headingPath: headingPathAtIndex(content, match.index),
      surroundingText,
    });

    counter += 1;
  }

  return instructions;
}

export function replaceInstructions(
  content: string,
  replacements: DeliverableReplacement[],
): string {
  let nextContent = content;

  for (const replacement of replacements) {
    nextContent = nextContent.replace(
      new RegExp(`\\[\\[INSTRUCTION:\\s*[\\s\\S]*?\\]\\]`),
      replacement.content.trim(),
    );
  }

  return nextContent;
}

export function stripBuildFrontmatter(markdown: string): string {
  return matter(markdown).content.trim();
}

export function sanitizeFrontmatter(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = { ...frontmatter };
  delete sanitized.output;
  delete sanitized.description;
  return sanitized;
}
