import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeDerivedSite } from '../tests/derived-site.mjs';
// A public widget-key fixture is NOT a verification bypass. Tests replace the
// external widget script and external provider fetch; the actual Action runs.
const build = (cwd) => {
  const result = spawnSync(
    process.execPath,
    [resolve('node_modules/astro/bin/astro.mjs'), 'build'],
    {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        PUBLIC_APP_ENV: 'experiment',
        PUBLIC_TURNSTILE_SITE_KEY: 'fixture-public-key',
        ASTRO_TELEMETRY_DISABLED: '1',
        WRANGLER_SEND_METRICS: 'false',
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
build('.');
// Built after the template so a fresh template build cannot clear it.
build(writeDerivedSite());
