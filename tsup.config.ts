import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync, chmodSync, cpSync, existsSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  entry: {
    'bin/wiki': 'bin/wiki.ts',
  },
  format: ['esm'],
  outDir: 'dist',
  bundle: true,
  clean: true,
  shims: true,
  define: {
    __PKG_VERSION__: JSON.stringify(version),
  },
  async onSuccess() {
    const out = 'dist/bin/wiki.js';
    const content = readFileSync(out, 'utf8');
    if (!content.startsWith('#!')) {
      writeFileSync(out, '#!/usr/bin/env node\n' + content);
    }
    chmodSync(out, '755');

    if (existsSync('scaffold')) {
      cpSync('scaffold', 'dist/scaffold', { recursive: true, force: true });
    }

    if (existsSync('examples')) {
      cpSync('examples', 'dist/examples', { recursive: true, force: true });
    }

    if (existsSync('chat')) {
      cpSync('chat', 'dist/chat', { recursive: true, force: true });
    }
  },
});
