import { spawnSync } from 'node:child_process';
// A public widget-key fixture is NOT a verification bypass. Tests replace the
// external widget script and external provider fetch; the actual Action runs.
const result = spawnSync(process.execPath, ['node_modules/astro/bin/astro.mjs', 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PUBLIC_APP_ENV: 'experiment',
    PUBLIC_TURNSTILE_SITE_KEY: 'fixture-public-key',
    ASTRO_TELEMETRY_DISABLED: '1',
    WRANGLER_SEND_METRICS: 'false',
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
