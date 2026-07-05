import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { resolveConfig, resolveConfigDetails, type EffectiveConfigDetails } from './schema.ts';
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

async function loadConfigInput(startDir: string): Promise<{
  rawConfig: unknown;
  wikiRoot: string;
  configPath?: string;
}> {
  const workspaceEnv = process.env.WIKI_WORKSPACE ?? process.env.WIKI_WORKSPACE_PATH;
  if (workspaceEnv && !path.isAbsolute(workspaceEnv)) {
    process.stderr.write(
      `Warning: WIKI_WORKSPACE_PATH "${workspaceEnv}" is a relative path — resolved against process.cwd() as "${path.resolve(workspaceEnv)}". Use an absolute path to avoid CWD-dependent resolution.\n`,
    );
  }
  const workspaceRoot = workspaceEnv ? path.resolve(workspaceEnv) : undefined;
  const searchRoot = workspaceRoot ?? startDir;
  const explicitConfigPath = process.env.WIKI_CONFIG_PATH
    ? path.resolve(searchRoot, process.env.WIKI_CONFIG_PATH)
    : undefined;
  const configPath = explicitConfigPath ?? (await findConfigPath(searchRoot));

  if (!configPath) {
    return { rawConfig: {}, wikiRoot: path.resolve(searchRoot) };
  }

  const rawText = await readFile(configPath, 'utf8');
  const rawConfig = rawText.trim() ? YAML.parse(rawText) : {};
  const wikiRoot = workspaceRoot ?? path.dirname(configPath);

  return { rawConfig, wikiRoot, configPath };
}

export async function loadConfig(startDir: string): Promise<AppConfig> {
  const input = await loadConfigInput(startDir);
  return resolveConfig(input.rawConfig, input.wikiRoot, input.configPath);
}

export async function loadConfigDetails(startDir: string): Promise<EffectiveConfigDetails> {
  const input = await loadConfigInput(startDir);
  return resolveConfigDetails(input.rawConfig, input.wikiRoot, input.configPath);
}
