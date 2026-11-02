import { test, expect, type Page, type Site } from './site-test';
import { axeViolations, violatedRules } from './axe';

// Every page and every state a visitor meets passes axe's WCAG 2.2 A/AA rules, in both
// themes, on a phone and on a desktop. The template and the derived-site fixture each run
// this file through their own Playwright project.
type Locale = Site['locales'][number];
const widgetScript = `window.turnstile={render(el,options){el.style.display='block';el.style.width='300px';options.callback('fixture-token');return 'fixture-widget';},reset(){}};`;
const viewports = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};
const themes = ['light', 'dark'] as const;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function rejectCookies(page: Page, site: Site) {
  const names = site.locales.map((locale) => escapeRegExp(site.messages(locale).cookie.rejectAll));
  await page.getByRole('button', { name: new RegExp(`^(${names.join('|')})$`) }).click();
}
async function expectAccessible(page: Page, state: string) {
  expect(await axeViolations(page), state).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: widgetScript }),
  );
});

for (const [device, viewport] of Object.entries(viewports))
  for (const theme of themes)
    test.describe(`${device}, ${theme} theme`, () => {
      test.use({ viewport, colorScheme: theme });
      test.beforeEach(async ({ page }) => {
        // The stored choice the footer switcher would save; a first visit is light.
        if (theme === 'dark') await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
      });
      const at = async (page: Page, path: string) => {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      };

      test('every page and the not-found page pass axe', async ({ page, site }) => {
        await at(page, site.pathFor(site.locales[0], 'home'));
        await rejectCookies(page, site);
        for (const locale of site.locales) {
          for (const { key } of site.pages) {
            const path = site.pathFor(locale, key);
            await at(page, path);
            await expectAccessible(page, path);
          }
          const missing = `${site.pathFor(locale, 'home').replace(/\/$/, '')}/no-such-page`;
          await at(page, missing);
          await expectAccessible(page, missing);
        }
      });

      test('the cookie card and its customize options pass axe', async ({ page, site }) => {
        for (const locale of site.locales) {
          const { cookie } = site.messages(locale);
          await at(page, site.pathFor(locale, 'home'));
          await expect(page.getByRole('region', { name: cookie.title })).toBeVisible();
          await expectAccessible(page, `${locale} cookie card`);
          const customize = page.getByRole('button', { name: cookie.customize, exact: true });
          await customize.click();
          await expect(customize).toHaveAttribute('aria-expanded', 'true');
          await expect(page.getByRole('checkbox', { name: cookie.analytics })).toBeVisible();
          await expectAccessible(page, `${locale} cookie options`);
        }
      });

      test('the open menu, its submenus and the language menu pass axe', async ({ page, site }) => {
        await at(page, site.pathFor(site.locales[0], 'home'));
        await rejectCookies(page, site);
        for (const locale of site.locales) {
          const t = site.messages(locale).accessibility;
          await at(page, site.pathFor(locale, 'home'));
          const banner = page.getByRole('banner');
          const expectGroupsVisible = async (
            within: ReturnType<Page['locator']>,
            labels: ReturnType<Site['menuLabels']>,
          ) => {
            for (const name of Object.values(labels.groups)) {
              const list = within.getByRole('list', { name, exact: true });
              await expect(list).toBeVisible();
              const links = await list.getByRole('link').all();
              expect(links.length, `${locale} ${labels.label} ${name} links`).toBeGreaterThan(0);
              for (const link of links) await expect(link).toBeVisible();
            }
          };
          if (device === 'phone') {
            await banner.getByRole('button', { name: t.openMenu, exact: true }).click();
            const drawer = page.getByRole('dialog', { name: t.mobileNavigation });
            await expect(drawer).toBeVisible();
            await expectAccessible(page, `${locale} menu drawer`);
            for (const menu of site.navMenus) {
              const labels = site.menuLabels(locale, menu);
              await drawer.getByText(labels.label, { exact: true }).click();
              await expectGroupsVisible(drawer, labels);
              await expectAccessible(page, `${locale} ${labels.label} drawer group`);
            }
          } else {
            const nav = banner.getByRole('navigation', { name: t.mainNavigation });
            for (const menu of site.navMenus) {
              const labels = site.menuLabels(locale, menu);
              const trigger = nav.getByRole('button', { name: labels.label, exact: true });
              await trigger.click();
              await expect(trigger).toHaveAttribute('aria-expanded', 'true');
              await expectGroupsVisible(nav, labels);
              await expectAccessible(page, `${locale} ${labels.label} submenu`);
              await page.keyboard.press('Escape');
              await expect(trigger).toHaveAttribute('aria-expanded', 'false');
            }
          }
          if (site.locales.length < 2) continue;
          const trigger = banner
            .getByLabel(t.language.replace('{language}', site.localeTable[locale].name), {
              exact: true,
            })
            .filter({ visible: true });
          await trigger.click();
          const other = site.locales.find((code) => code !== locale)!;
          await expect(
            page.getByRole('link', { name: site.localeTable[other].name, exact: true }),
          ).toBeVisible();
          await expectAccessible(page, `${locale} language menu`);
        }
      });

      test('the inquiry form with validation errors passes axe', async ({ page, site }) => {
        await at(page, site.pathFor(site.locales[0], 'home'));
        await rejectCookies(page, site);
        for (const locale of site.locales) {
          const f = site.messages(locale).inquiry.form;
          await at(page, site.pathFor(locale, 'contact'));
          await page.getByLabel(f.email, { exact: true }).fill('not-an-email');
          await page.getByRole('button', { name: f.submit, exact: true }).click();
          await expect(page.getByText(f.errors.fullName.required, { exact: true })).toBeVisible();
          await expect(page.getByText(f.errors.email.invalid, { exact: true })).toBeVisible();
          await expectAccessible(page, `${locale} inquiry errors`);
        }
      });
    });

// The check above is only worth something if it fails: a field that loses its label and
// text that loses its contrast must both be reported.
test('axe reports a field without a label and text without contrast', async ({ page, site }) => {
  const locale = site.locales[0];
  const f = site.messages(locale).inquiry.form;
  await page.goto(site.pathFor(locale, 'contact'));
  await rejectCookies(page, site);
  expect(await violatedRules(page)).toEqual([]);
  const field = page.getByLabel(f.fullName, { exact: true });
  await field.evaluate((input) => {
    for (const label of (input as HTMLInputElement).labels ?? []) label.remove();
    input.removeAttribute('aria-label');
    input.removeAttribute('aria-labelledby');
  });
  // Pale grey on the light theme's near-white page: about 1.3:1, far below 4.5:1.
  await page
    .getByRole('heading', { level: 1 })
    .evaluate((heading) => heading.style.setProperty('color', '#e5e5e5'));
  const rules = await violatedRules(page);
  expect(rules).toContain('label');
  expect(rules).toContain('color-contrast');
});
