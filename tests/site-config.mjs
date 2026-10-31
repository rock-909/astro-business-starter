import { resolve } from 'node:path';
import { createServer } from 'vite';

// Loads `src/site.ts` (pages, locales, identity and copy) the way Astro does, so tests
// derive expected pages and wording from the checkout instead of pinning the template's.
/** @param {string} [root] checkout holding `src/site.ts` */
export async function loadSite(root = '.') {
  const server = await createServer({
    root: resolve(root),
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    /** @type {typeof import('../src/site.ts')} */
    const site = await server.ssrLoadModule('/src/site.ts');
    return site;
  } finally {
    await server.close();
  }
}
