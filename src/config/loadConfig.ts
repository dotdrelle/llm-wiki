import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { resolveConfig } from './schema.ts';
import type { AppConfig } from '../types.ts';

const CONFIG_FILE_NAMES = ['.wikirc.yaml', '.wikirc.yml'];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findConfigPath(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);

  while (true) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const candidate = path.join(current, fileName);
      if (await fileExists(candidate)) {
        return candidate;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export async function loadConfig(startDir: string): Promise<AppConfig> {
  const configPath = await findConfigPath(startDir);

  if (!configPath) {
    return resolveConfig({}, path.resolve(startDir));
  }

  const rawText = await readFile(configPath, 'utf8');
  const rawConfig = rawText.trim() ? YAML.parse(rawText) : {};
  const wikiRoot = path.dirname(configPath);

  return resolveConfig(rawConfig, wikiRoot, configPath);
}
