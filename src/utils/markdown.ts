import type { DeliverableReplacement, TemplateInstruction } from '../types.ts';

export interface MarkdownChunk {
  headingPath: string[];
  heading: string;
  content: string;
}

export interface MarkdownSection {
  headingPath: string[];
  headingLevel: number;
  headingText: string;
  markdown: string;
}

export interface MarkdownSectionDocument {
  frontmatter: string;
  preamble: string;
  sections: MarkdownSection[];
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

function splitMarkdownFrontmatter(markdown: string): { frontmatter: string; body: string } {
  if (!markdown.startsWith('---\n')) return { frontmatter: '', body: markdown };
  const end = markdown.indexOf('\n---', 4);
  if (end < 0) return { frontmatter: '', body: markdown };
  const closeEnd = markdown.indexOf('\n', end + 4);
  if (closeEnd < 0) {
    return { frontmatter: `${markdown.slice(0, end + 4)}\n`, body: '' };
  }
  return {
    frontmatter: markdown.slice(0, closeEnd + 1),
    body: markdown.slice(closeEnd + 1),
  };
}

export function normalizeHeadingPathKey(headingPath: string[]): string {
  return headingPath
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
    .join(' > ');
}

export function splitMarkdownSections(markdown: string): MarkdownSectionDocument {
  const { frontmatter, body } = splitMarkdownFrontmatter(markdown.replace(/\r\n?/g, '\n'));
  const lines = body.split('\n');
  const sections: MarkdownSection[] = [];
  const headingStack: Array<{ depth: number; title: string }> = [];
  const preambleLines: string[] = [];
  let currentLines: string[] = [];
  let currentHeading:
    | { headingPath: string[]; headingLevel: number; headingText: string }
    | undefined;
  let inFence = false;

  const flush = () => {
    if (!currentHeading) return;
    const markdown = currentLines.join('\n').trim();
    if (!markdown) return;
    sections.push({
      ...currentHeading,
      markdown,
    });
  };

  for (const line of lines) {
    if (/^`{3,}/.test(line.trim())) {
      inFence = !inFence;
    }

    const headingMatch = !inFence ? /^(#{1,6})\s+(.+?)\s*$/.exec(line) : null;
    if (headingMatch) {
      flush();
      const depth = headingMatch[1].length;
      const title = headingMatch[2].trim();
      while (headingStack.length > 0 && headingStack.at(-1)!.depth >= depth) {
        headingStack.pop();
      }
      headingStack.push({ depth, title });
      currentHeading = {
        headingPath: headingStack.map((entry) => entry.title),
        headingLevel: depth,
        headingText: title,
      };
      currentLines = [line];
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  flush();

  return {
    frontmatter,
    preamble: preambleLines.join('\n').trim(),
    sections,
  };
}

export function extractWikiLinks(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((match) =>
    match[1].trim(),
  );
}

export function extractSourceCitations(content: string): string[] {
  return [...content.matchAll(/\[src:\s*([^\]]+)\]/gi)].map((match) => match[1].trim());
}

export function splitSourceSections(content: string, maxChars: number): string[] {
  const titleMatch = /^(# .+?)(?:\n|$)/.exec(content);
  const titlePrefix = titleMatch ? `${titleMatch[1]}\n\n` : '';
  const body = titleMatch ? content.slice(titleMatch[0].length).trim() : content.trim();
  if (!body) return titlePrefix ? [titlePrefix.trim()] : [];

  const splitAtHeading = (text: string, level: 2 | 3): string[] => {
    const marker = `${'#'.repeat(level)} `;
    const sections: string[] = [];
    let current: string[] = [];

    for (const line of text.split('\n')) {
      if (line.startsWith(marker) && current.length > 0) {
        sections.push(current.join('\n').trim());
        current = [line];
      } else {
        current.push(line);
      }
    }

    const last = current.join('\n').trim();
    if (last) sections.push(last);
    return sections;
  };

  const withTitle = (section: string): string => {
    const cleanSection = section.trim();
    return titlePrefix && !cleanSection.startsWith('# ')
      ? `${titlePrefix}${cleanSection}`
      : cleanSection;
  };

  const withTitleAndLimit = (section: string): string => {
    const cleanSection = section.trim();
    const combined = withTitle(cleanSection);
    if (combined.length <= maxChars) return combined;

    if (!titlePrefix || cleanSection.startsWith('# ')) {
      return truncateSection(cleanSection, maxChars);
    }

    const budget = maxChars - titlePrefix.length;
    if (budget <= 0) return titlePrefix.slice(0, maxChars);
    return `${titlePrefix}${truncateSection(cleanSection, budget)}`;
  };

  const fitSection = (section: string): string[] => {
    if (withTitle(section).length <= maxChars) return [withTitle(section)];

    const h3Sections = splitAtHeading(section, 3);
    if (h3Sections.length > 1) {
      const [prefix, ...rest] = h3Sections;
      const prefixHasBody = prefix
        .split('\n')
        .some((line) => line.trim() && !/^#{1,6}\s+/.test(line.trim()));
      if (!prefixHasBody && rest.length > 0) {
        return rest.map((subsection) => withTitleAndLimit(`${prefix}\n\n${subsection}`));
      }
      return h3Sections.map(withTitleAndLimit);
    }

    return [withTitleAndLimit(section)];
  };

  return splitAtHeading(body, 2).flatMap(fitSection);
}

function truncateSection(section: string, maxChars: number): string {
  const suffix = '\n...[section truncated]';
  if (section.length <= maxChars) return section;
  if (maxChars <= suffix.length) return section.slice(0, maxChars);
  return `${section.slice(0, maxChars - suffix.length).trimEnd()}${suffix}`;
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

function headingLevelAtIndex(content: string, index: number): number {
  const before = content.slice(0, index);
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  let level = 0;

  while ((match = headingPattern.exec(before)) !== null) {
    level = match[1].length;
  }

  return level;
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
      headingLevel: headingLevelAtIndex(content, match.index),
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

export function sanitizeFrontmatter(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = { ...frontmatter };
  delete sanitized.output;
  delete sanitized.description;
  return sanitized;
}

function normalizeGeneratedLine(line: string): string {
  return line
    .replace(/<br\s*\/?>/gi, '  ')
    .replace(/<\/?(strong|b)>/gi, '**')
    .replace(/<\/?(em|i)>/gi, '*')
    .replace(/<\/?(span|div|p)>/gi, '')
    .replace(/<[^>]+>/g, '');
}

function normalizeFallbackTitle(title: string | undefined): string {
  const normalized = title?.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || 'Untitled';
}

function ensureFirstBodyLineIsH1(body: string, fallbackTitle?: string): string {
  if (!body) return `# ${normalizeFallbackTitle(fallbackTitle)}`;

  const lines = body.split('\n');
  let inFence = false;
  let firstHeadingIndex = -1;
  let firstHeading: RegExpExecArray | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^`{3,}/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }

    if (inFence) continue;

    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      firstHeadingIndex = index;
      firstHeading = heading;
      break;
    }
  }

  if (!firstHeading) {
    return `# ${normalizeFallbackTitle(fallbackTitle)}\n\n${body}`;
  }

  const titleLine = `# ${firstHeading[2].trim()}`;
  if (firstHeadingIndex === 0) {
    return [titleLine, ...lines.slice(1)].join('\n');
  }

  const preamble = lines.slice(0, firstHeadingIndex).join('\n').trim();
  const rest = lines.slice(firstHeadingIndex + 1).join('\n').trim();
  return [titleLine, preamble, rest].filter(Boolean).join('\n\n');
}

export function normalizeGeneratedMarkdown(markdown: string, fallbackTitle?: string): string {
  const { frontmatter, body } = splitMarkdownFrontmatter(markdown.replace(/\r\n?/g, '\n'));
  const lines = body.split('\n');
  const out: string[] = [];
  let inFence = false;
  let seenH1 = false;

  const pushBlank = () => {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
  };

  for (const rawLine of lines) {
    const fence = /^`{3,}/.test(rawLine.trim());
    if (fence) {
      pushBlank();
      out.push(rawLine);
      inFence = !inFence;
      continue;
    }

    let line = inFence ? rawLine : normalizeGeneratedLine(rawLine).replace(/[ \t]+$/g, '');
    const heading = !inFence ? /^(#{1,6})\s+(.+?)\s*$/.exec(line) : null;
    if (heading) {
      let marks = heading[1];
      if (marks.length === 1) {
        if (seenH1) marks = '##';
        else seenH1 = true;
      }
      line = `${marks} ${heading[2].trim()}`;
      pushBlank();
      out.push(line);
      out.push('');
      continue;
    }

    out.push(line);
  }

  const normalizedBody = ensureFirstBodyLineIsH1(
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    fallbackTitle,
  );
  return `${frontmatter}${normalizedBody}${normalizedBody ? '\n' : ''}`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

function stripTagAttributes(markdown: string): string {
  return markdown.replace(/<([a-z][\w:-]*)\b[^>]*>/gi, '<$1>');
}

export function normalizeSourceBody(markdown: string): string {
  let normalized = markdown;

  normalized = normalized.replace(
    /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote: string, href: string, label: string) =>
      `[${decodeHtmlEntities(label.replace(/<[^>]+>/g, '').trim())}](${decodeHtmlEntities(href)})`,
  );
  normalized = normalized.replace(
    /<time\b[^>]*datetime=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/time>/gi,
    (_match, _quote: string, datetime: string, label: string) =>
      decodeHtmlEntities(label.replace(/<[^>]+>/g, '').trim() || datetime),
  );
  normalized = stripTagAttributes(normalized);
  normalized = normalized
    .replace(/<\/?(strong|b)>/gi, '**')
    .replace(/<\/?(em|i)>/gi, '*')
    .replace(/<\/?(span|div|p)>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(ul|ol)>/gi, '\n')
    .replace(/<li>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?(table|tbody|thead)>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<tr>/gi, '')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<t[dh]>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/`{2,}(\s*[-*]?\s*)/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  return decodeHtmlEntities(normalized).trim();
}
