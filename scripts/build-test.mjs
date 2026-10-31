import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeDerivedSite } from '../tests/derived-site.mjs';
import { testBuildEnv } from '../tests/site-config.mjs';
const build = (cwd) => {
  const result = spawnSync(
    process.execPath,
    [resolve('node_modules/astro/bin/astro.mjs'), 'build'],
    {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...testBuildEnv,
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
