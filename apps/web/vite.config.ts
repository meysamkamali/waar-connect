import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// Served by Nginx under /app/ while the phase 0 pages keep /. Moves to / when they retire.
export default defineConfig({
  base: '/app/',
  plugins: [preact()],
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
