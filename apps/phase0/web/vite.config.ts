import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

export default defineConfig({
  root,
  publicDir: 'public',
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2022',
    // livekit-client alone is ~570 kB minified; one shared chunk, cached after the first page.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        index: page('index'),
        guest: page('guest'),
        out: page('out'),
        studio: page('studio'),
        monitor: page('monitor'),
        clock: page('clock'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
