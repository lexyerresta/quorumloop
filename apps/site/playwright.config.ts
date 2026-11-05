import { defineConfig, devices } from '@playwright/test';

// Click-through of the static project page. Start it with `pnpm --filter @quorumloop/site dev`
// or `preview`, or point QUORUMLOOP_SITE_URL at another copy.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: process.env.QUORUMLOOP_SITE_URL ?? 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
  ],
});
