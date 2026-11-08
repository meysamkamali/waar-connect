import { execSync } from 'node:child_process';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

// Every build gets an id (time + commit). The pages carry it as __WC_BUILD__, and /app/version.json
// says which build the server has, so a page can tell when it is behind (a phone that stayed open
// across a deploy) and the producer sees it on the guest's card.
function buildId(): string {
  let commit = process.env['WC_COMMIT'] ?? 'dev';
  if (commit !== 'dev') return `${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${commit}`;
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    // not a git checkout (the VM gets a tarball): time alone is enough
  }
  return `${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${commit}`;
}

const build = buildId();

const versionFile: Plugin = {
  name: 'wc-version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) });
  },
};

// Served by Nginx under /app/ while the phase 0 pages keep /. Moves to / when they retire.
export default defineConfig({
  base: '/app/',
  plugins: [preact(), versionFile],
  define: { __WC_BUILD__: JSON.stringify(build) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:8788' },
  },
});
