import { access } from 'node:fs/promises';
import path from 'node:path';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findEnvPath(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, '.env');
    if (await fileExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function loadWorkspaceEnv(startDir: string): Promise<void> {
  const workspace = process.env.WIKI_WORKSPACE ?? process.env.WIKI_WORKSPACE_PATH;
  const explicitEnv = process.env.WIKI_ENV_FILE
    ? path.resolve(startDir, process.env.WIKI_ENV_FILE)
    : undefined;
  const selectedWorkspaceEnv = workspace
    ? path.join(path.resolve(startDir, workspace), '.env')
    : undefined;
  const discoveredEnv = await findEnvPath(startDir);
  const envPaths = [explicitEnv, selectedWorkspaceEnv, discoveredEnv].filter(
    (envPath): envPath is string => Boolean(envPath),
  );

  for (const envPath of [...new Set(envPaths)]) {
    if (await fileExists(envPath)) {
      process.loadEnvFile(envPath);
    }
  }
}
