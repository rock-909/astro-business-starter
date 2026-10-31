import { defineConfig } from '@playwright/test';
import { derivedRoot } from './tests/derived-site.mjs';
import type { SiteOptions } from './tests/site-test';

// TEST_PORT moves the four loopback servers (template app and control, derived app and
// control) so parallel checkouts on one machine never test each other's build.
const base = Number(process.env.TEST_PORT || 4173);
if (!Number.isInteger(base) || base < 1024 || base > 65532)
  throw new Error('TEST_PORT must be a port number from 1024 to 65532');
const url = (offset: number) => `http://127.0.0.1:${base + offset}`;
const servers = [
  { name: 'template', root: '.', app: 0, control: 1 },
  { name: 'derived', root: derivedRoot, app: 2, control: 3 },
];
export default defineConfig<SiteOptions>({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // A stray test.only would otherwise skip the rest of the suite and keep CI green.
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: 0,
  use: {
    browserName: 'chromium',
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--no-sandbox'],
    },
    // A renamed label fails in seconds instead of waiting out the whole test timeout.
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: servers.map(({ name, root, app, control }) => ({
    name,
    use: { baseURL: url(app), controlURL: url(control), siteRoot: root },
  })),
  webServer: servers.map(({ root, app, control }) => ({
    command: `node tests/server.mjs --root ${root} --port ${base + app} --control-port ${base + control}`,
    url: `${url(app)}/api/health`,
    // A server already on the port may serve another checkout's or an older build, so
    // it is never trusted by default. Opt in only after confirming it serves this build.
    reuseExistingServer: !process.env.CI && process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === 'true',
    timeout: 30_000,
  })),
  reporter: [['list'], ['html', { open: 'never' }]],
});
