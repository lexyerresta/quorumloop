import { defineConfig } from 'vitest/config';

// Static project page. `base` is relative so the build works from any path, including a
// GitHub Pages project URL, without a rebuild.
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  build: { outDir: 'dist' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
