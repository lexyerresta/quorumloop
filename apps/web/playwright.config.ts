import { defineConfig, devices } from '@playwright/test';

// Runs against a live stack: `pnpm dev:core` (gateway on 7001) plus the Vite dev server on 5173.
// The click-through signs in with SMOKE_EMAIL / SMOKE_PASSWORD from the repository .env.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: process.env.QUORUMLOOP_WEB_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
  ],
});
