import { test as base } from '@playwright/test';
import { loadSite } from './site-config.mjs';

export type Site = Awaited<ReturnType<typeof loadSite>>;
export interface SiteOptions {
  /** Checkout whose `src/` produced the build under test (the template or a derived fixture). */
  siteRoot: string;
  /** Loopback control server of the harness serving that build. */
  controlURL: string;
}
// Expectations come from the same site config and copy the build was made from, so a
// derived site with its own pages and wording runs the same journeys.
export const test = base.extend<
  Pick<SiteOptions, 'controlURL'>,
  Pick<SiteOptions, 'siteRoot'> & { site: Site }
>({
  controlURL: ['http://127.0.0.1:4174', { option: true }],
  siteRoot: ['.', { option: true, scope: 'worker' }],
  site: [async ({ siteRoot }, use) => use(await loadSite(siteRoot)), { scope: 'worker' }],
});
export { expect, type Page } from '@playwright/test';
