import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // A stray test.only would otherwise skip the rest of the suite and keep CI green.
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/server.mjs',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
