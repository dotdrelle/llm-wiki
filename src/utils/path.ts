import path from 'node:path';

export function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

export function canonicalizeName(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]+/gu, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function slugifyPath(relativePath: string): string {
  const sluggedParts = relativePath
    .split('/')
    .map((part) => {
      const ext = path.extname(part);
      const base = part.slice(0, part.length - ext.length);
      return slugify(base) + ext;
    })
    .filter(Boolean);

  return sluggedParts
    .filter((part, index) => index === 0 || part !== sluggedParts[index - 1])
    .join('/');
}

export function resolveInside(rootDir: string, candidate: string): string {
  const absolutePath = path.resolve(rootDir, candidate);
  const relativePath = path.relative(rootDir, absolutePath);

  if (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  ) {
    return absolutePath;
  }

  throw new Error(`Path escapes workspace root: ${candidate}`);
}

export function relativeFrom(rootDir: string, targetPath: string): string {
  return toPosix(path.relative(rootDir, targetPath));
}

export function normalizeSafeRelativePath(raw: string): string | null {
  const normalized = toPosix(path.posix.normalize(raw));
  if (normalized !== raw || normalized.startsWith('../') || normalized === '..') {
    return null;
  }
  return normalized;
}
