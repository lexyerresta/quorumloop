import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The dev server proxies the gateway so the browser sees one origin. The session cookie and the
// CSRF check then behave exactly as they do behind the production reverse proxy.
const gateway = process.env.QUORUMLOOP_GATEWAY_URL ?? 'http://127.0.0.1:7001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: gateway, changeOrigin: false },
    },
  },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
