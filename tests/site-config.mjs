import { resolve } from 'node:path';
import { createServer } from 'vite';

// Public values `npm run build:test` forces over the shell and dotenv files. A public
// widget-key fixture is NOT a verification bypass: tests replace the external widget
// script and external provider fetch; the actual Action runs.
export const testBuildEnv = {
  PUBLIC_APP_ENV: 'experiment',
  PUBLIC_TURNSTILE_SITE_KEY: 'fixture-public-key',
};

// Loads `src/site.ts` (pages, locales, identity and copy) the way `astro build` does, so
// tests derive expected pages and wording from the checkout instead of pinning the
// template's. Public values resolve like the build: `env` over the shell over
// `.env.production` over `.env`, PUBLIC_ prefix only.
/**
 * @param {string} [root] checkout holding `src/site.ts`
 * @param {Record<string, string>} [env] values the build forced over the shell
 */
export async function loadSite(root = '.', env = testBuildEnv) {
  const shell = { ...process.env };
  Object.assign(process.env, env);
  let server;
  try {
    server = await createServer({
      root: resolve(root),
      configFile: false,
      mode: 'production',
      envPrefix: 'PUBLIC_',
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false },
      appType: 'custom',
    });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in shell)) delete process.env[key];
    Object.assign(process.env, shell);
  }
  try {
    /** @type {typeof import('../src/site.ts')} */
    const site = await server.ssrLoadModule('/src/site.ts');
    return site;
  } finally {
    await server.close();
  }
}
