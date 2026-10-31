import { test, expect, type Page, type Site } from './site-test';

type Locale = Site['locales'][number];
const widgetScript = `window.turnstile={render(el,options){window.__turnstileOptions=options;el.style.display='block';el.style.width=options.size==='compact'?'150px':'300px';const button=document.createElement('button');button.type='button';button.textContent='[Test] Complete verification';button.onclick=()=>options.callback('fixture-token');el.append(button);options.callback('fixture-token');return 'fixture-widget';},reset(){}};`;
async function mockWidget(page: Page) {
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: widgetScript }),
  );
}
// A widget still waiting for its challenge: it renders but has not produced a token yet.
const pendingWidgetScript = `window.turnstile={render(el,options){window.__turnstileOptions=options;el.style.display='block';el.style.width=options.size==='compact'?'150px':'300px';return 'fixture-widget';},reset(){}};`;
// Render the contact blocks with a long unbreakable address: the template ships without a
// company email (launched sites must configure one), a derived site already has one.
const longEmail = 'internationalsales@guangzhouhengtaimachinery.com';
const htmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
};
// Astro escapes text the same way before it reaches the HTML.
const escapeHtml = (text: string) => text.replace(/[&<>'"]/g, (char) => htmlEntities[char]);
async function withLongCompanyEmail(page: Page, site: Site) {
  const contactPaths = site.locales.map((locale) => site.pathFor(locale, 'contact'));
  await page.route(
    (url) => contactPaths.includes(url.pathname),
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const response = await route.fetch();
      const { pathname } = new URL(route.request().url());
      const locale = site.locales.find((code) => contactPath(site, code) === pathname)!;
      const link = `<a class="text-link" href="mailto:${longEmail}">${longEmail}</a>`;
      const title = escapeHtml(site.messages(locale).contact.panel.contactTitle);
      const methods = `<section class="contact-methods" aria-labelledby="contact-methods"><h2 id="contact-methods">${title}</h2>${link}</section>`;
      let html = await response.text();
      // A configured block is replaced; the template has none, so one goes where it would render.
      const configured = /<section class="contact-methods"[\s\S]*?<\/section>/;
      if (configured.test(html)) html = html.replace(configured, methods);
      else
        html = html.replace(
          '</div><div class="page-aside">',
          `${methods}</div><div class="page-aside">`,
        );
      if (!/class="fallback"[^>]*>[^<]*<a [^>]*href="mailto:/.test(html))
        html = html.replace('</form>', `</form><p class="fallback">${link}</p>`);
      await route.fulfill({ response, body: html });
    },
  );
}
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function dismissConsent(page: Page, site: Site) {
  const names = site.locales.map((locale) => escapeRegExp(site.messages(locale).cookie.rejectAll));
  const reject = page.getByRole('button', { name: new RegExp(`^(${names.join('|')})$`) });
  if (await reject.isVisible()) await reject.click();
}
// Expected wording comes from the site's own copy, never from the template's.
const form = (site: Site, locale: Locale) => site.messages(locale).inquiry.form;
const messageLabel = (site: Site, locale: Locale) =>
  `${form(site, locale).message} (${form(site, locale).optional})`;
// Each language is offered under its own name, in the header menu on wide screens and in
// the phone drawer below 840px.
const languageLink = (page: Page, site: Site, locale: Locale) =>
  page.getByRole('link', { name: site.localeTable[locale].name, exact: true });
const languageTrigger = (page: Page, site: Site, locale: Locale) =>
  page
    .getByRole('banner')
    .getByLabel(
      site
        .messages(locale)
        .accessibility.language.replace('{language}', site.localeTable[locale].name),
      { exact: true },
    )
    .filter({ visible: true });
async function openLanguages(page: Page, site: Site) {
  const current = (await page.locator('html').getAttribute('lang')) as Locale;
  const t = site.messages(current).accessibility;
  if (!(await page.locator('[data-language-menu]').isVisible())) {
    await page.getByRole('button', { name: t.openMenu, exact: true }).click();
    await expect(page.getByRole('dialog', { name: t.mobileNavigation })).toBeVisible();
  }
  const trigger = languageTrigger(page, site, current);
  if (!(await trigger.evaluate((summary) => (summary.parentElement as HTMLDetailsElement).open)))
    await trigger.click();
}
async function switchLanguage(page: Page, site: Site, locale: Locale) {
  await openLanguages(page, site);
  await languageLink(page, site, locale).click();
}
// Brand names the footer gives each configured social network.
const socialNames = { linkedin: 'LinkedIn', twitter: 'X' };
// The footer theme switcher: one toggle button per theme, named by the theme.
type Theme = 'system' | 'light' | 'dark';
const themeButton = (page: Page, site: Site, locale: Locale, theme: Theme) =>
  page
    .getByRole('group', { name: site.messages(locale).accessibility.themeSelector })
    .getByRole('button', { name: site.messages(locale).theme[theme], exact: true });
const homeLocale = (site: Site) => site.locales[0];
const secondLocale = (site: Site) => site.locales[1];
const contactPath = (site: Site, locale: Locale) => site.pathFor(locale, 'contact');
declare global {
  interface Window {
    /** Any CSS colour (the theme tokens are OKLCH) as sRGB 0-255 channels plus 0-255 alpha. */
    rgba(color: string): number[];
  }
}
// Computed styles keep OKLCH as written, so colours are read back through a canvas pixel.
const installColorProbe = (page: Page) =>
  page.addInitScript(() => {
    const context = document
      .createElement('canvas')
      .getContext('2d', { willReadFrequently: true })!;
    window.rgba = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
  });
// A theme token as the same sRGB channels the probe gives for an element's colour.
const tokenColor = (page: Page, name: string) =>
  page.evaluate(
    (name) => window.rgba(getComputedStyle(document.documentElement).getPropertyValue(name)).join(),
    name,
  );
// The inquiry status box's background, border and text, and those of one callout tone.
const calloutColors = (page: Page) =>
  page.locator('[data-form-status]').evaluate((box) => {
    const style = getComputedStyle(box);
    return [style.backgroundColor, style.borderTopColor, style.color].map((color) =>
      window.rgba(color).join(),
    );
  });
const toneColors = async (page: Page, tone: 'info' | 'success' | 'warning' | 'error') =>
  Promise.all(
    [`--${tone}-muted`, `--${tone}-border`, `--${tone}-foreground`].map((name) =>
      tokenColor(page, name),
    ),
  );
// Colour transitions run 150ms; read a state only once they have finished.
const settled = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

test.beforeEach(async ({ page, request, controlURL }) => {
  await request.post(controlURL, { data: { reset: true } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as unknown as { unexpectedErrors: string[] }).unexpectedErrors = errors;
  await mockWidget(page);
  await installColorProbe(page);
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { unexpectedErrors: string[] }).unexpectedErrors).toEqual([]);
});

test('every configured page has localized HTML, reciprocal SEO and truthful noindex', async ({
  page,
  site,
}) => {
  const company = site.site.company?.name?.trim();
  for (const locale of site.locales) {
    for (const { key } of site.pages) {
      const path = site.pathFor(locale, key);
      const heading =
        key === 'home'
          ? site.messages(locale).home.title
          : site.pageContent(locale, key).metadata.title;
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      expect(response?.request().redirectedFrom(), `${path} must not redirect`).toBeNull();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      if (key === 'home') {
        // Each language titles its own home page, for search results and share cards.
        const title = site.messages(locale).home.metadata.title || site.site.seo.defaultTitle;
        await expect(page).toHaveTitle(title);
        await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', title);
      }
      expect(await page.locator('main').count()).toBe(1);
      const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
      expect(new URL(canonical!).pathname).toBe(path);
      for (const language of site.locales)
        await expect(page.locator(`link[hreflang=${language}]`)).toHaveCount(1);
      await expect(page.locator('link[hreflang=x-default]')).toHaveCount(1);
      await expect(page.locator('meta[name=robots]')).toHaveAttribute(
        'content',
        'noindex,nofollow',
      );
      const graph: Array<{ '@type': string; name?: string }> = JSON.parse(
        await page.locator('script[type="application/ld+json"]').innerHTML(),
      )['@graph'];
      // Organization facts appear only when the owner configured a company.
      const organization = graph.find((node) => node['@type'] === 'Organization');
      if (company) expect(organization?.name).toBe(site.site.company!.name);
      else expect(organization).toBeUndefined();
      expect(graph.some((node) => node['@type'] === 'WebSite')).toBe(true);
    }
  }
});

test('configured contact methods, logo and social links render; unconfigured ones stay absent', async ({
  page,
  site,
}) => {
  const { contact, social, brandAssets, name } = site.site;
  const digits = (value: string) => value.replace(/\D/g, '');
  for (const locale of site.locales) {
    await page.goto(contactPath(site, locale));
    const main = page.getByRole('main');
    // The contact details block exists only when a method is configured (a heading and links).
    const details = main.getByRole('region', {
      name: site.messages(locale).contact.panel.contactTitle,
      exact: true,
    });
    const address = Object.values(site.site.company?.location ?? {}).some(Boolean);
    await expect(details).toHaveCount(
      contact.email || contact.phone || contact.whatsapp || address ? 1 : 0,
    );
    if (contact.email)
      // Scoped to the contact details: the form's fallback line repeats the mailbox and
      // would otherwise hide a missing contact method.
      await expect(details.getByRole('link', { name: contact.email, exact: true })).toHaveAttribute(
        'href',
        `mailto:${contact.email}`,
      );
    else await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
    const phone = main.locator('a[href^="tel:"]');
    if (contact.phone) {
      await expect(phone).toHaveText(contact.phone);
      expect(digits((await phone.getAttribute('href'))!)).toBe(digits(contact.phone));
    } else await expect(phone).toHaveCount(0);
    const whatsapp = main.locator('a[href^="https://wa.me/"]');
    if (contact.whatsapp) {
      await expect(whatsapp).toContainText(contact.whatsapp);
      // wa.me takes the international number as bare digits.
      await expect(whatsapp).toHaveAttribute('href', `https://wa.me/${digits(contact.whatsapp)}`);
    } else await expect(whatsapp).toHaveCount(0);

    const logo = page.getByRole('banner').getByRole('img', { name, exact: true });
    if (brandAssets.logo?.status === 'ready') {
      await expect(logo).toHaveAttribute('src', brandAssets.logo.horizontal);
      // The configured file must actually be served, not just referenced.
      await expect
        .poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
    } else {
      // Like the reference site, a header without a configured logo shows no brand at all.
      await expect(page.getByRole('banner').getByRole('img')).toHaveCount(0);
      await expect(page.getByRole('banner').locator('.brand')).toHaveCount(0);
    }

    const footer = page.getByRole('contentinfo');
    const newTab = site.messages(locale).accessibility.opensInNewTab;
    for (const [network, href] of Object.entries(social)) {
      if (!href) continue;
      const link = footer.locator(`a[href="${href}"]`);
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute('rel', /noopener/);
      // Read as the network's name; the arrow is decorative and the new tab is announced.
      await expect(link).toHaveAccessibleName(
        `${socialNames[network as keyof typeof socialNames]} (${newTab})`,
      );
    }
    // Social networks are the only external pages; WhatsApp is a contact method.
    await expect(footer.locator('a[href^="http"]:not([href^="https://wa.me/"])')).toHaveCount(
      Object.values(social).filter(Boolean).length,
    );
    // The footer names the company and lists each configured way to reach it, like the
    // reference site; the Social column exists only when a network is configured.
    const company = site.site.company;
    const brandName = company?.name?.trim() || name;
    await expect(footer.getByText(brandName, { exact: true })).toBeVisible();
    await expect(footer).toContainText(`© ${new Date().getUTCFullYear()} ${brandName}`);
    const footerContact = footer.locator('address');
    if (contact.email)
      await expect(footerContact.getByRole('link', { name: contact.email })).toHaveAttribute(
        'href',
        `mailto:${contact.email}`,
      );
    await expect(footerContact.locator('a[href^="tel:"]')).toHaveCount(contact.phone ? 1 : 0);
    await expect(footerContact.locator('a[href^="https://wa.me/"]')).toHaveCount(
      contact.whatsapp ? 1 : 0,
    );
    const address = [
      company?.location?.address,
      company?.location?.city,
      company?.location?.country,
    ]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(', ');
    if (address) await expect(footerContact).toContainText(address);
    if (!contact.email && !contact.phone && !contact.whatsapp && !address)
      await expect(footerContact).toHaveCount(0);
    // Every contact line carries its icon.
    else
      await expect(footerContact.locator('svg')).toHaveCount(
        await footerContact.locator('a, p').count(),
      );
    const columns = site.messages(locale).footer.columns;
    await expect(footer.getByRole('heading', { level: 2 })).toHaveText([
      columns.navigation,
      columns.support,
      ...(Object.values(social).some(Boolean) ? [columns.social] : []),
    ]);
  }
});

test('unknown routes give localized 404 recovery rather than false business pages', async ({
  page,
  site,
}) => {
  for (const locale of site.locales) {
    const home = site.pathFor(locale, 'home');
    const notFound = site.messages(locale).errors.notFound;
    const response = await page.goto(`${home === '/' ? '' : home}/missing-offering`);
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(notFound.title);
    const contact = page.locator('main').getByRole('link', {
      name: site.messages(locale).footer.sections.navigation.contact,
      exact: true,
    });
    await expect(contact).toHaveAttribute('href', contactPath(site, locale));
    const goHome = page.getByRole('link', { name: notFound.goHome });
    expect((await goHome.boundingBox())!.height).toBe(40);
    expect((await contact.boundingBox())!.height).toBe(40);
    // Centred like the reference site: the title and the pair of buttons share the page's middle.
    const middle = page.viewportSize()!.width / 2;
    const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    expect(Math.abs(title.x + title.width / 2 - middle)).toBeLessThan(2);
    const first = (await goHome.boundingBox())!;
    const last = (await contact.boundingBox())!;
    expect(Math.abs((first.x + last.x + last.width) / 2 - middle)).toBeLessThan(2);
    await expect(contact).toHaveClass(/\boutline\b/);
    await goHome.click();
    await expect(page).toHaveURL(home);
    await page.goto(`${home === '/' ? '' : home}/missing-offering`);
    await contact.click();
    await expect(page).toHaveURL(contactPath(site, locale));
  }
});

test('locale switch preserves route, query, hash and unsent buyer fields', async ({
  page,
  site,
}) => {
  const [first, second] = [homeLocale(site), secondLocale(site)];
  test.skip(!second, 'single-language site');
  await page.goto(`${contactPath(site, first)}?utm_source=locale-test#inquiry`);
  await dismissConsent(page, site);
  await page.getByLabel(form(site, first).fullName, { exact: true }).fill('Alex Buyer');
  await page.getByLabel(form(site, first).email, { exact: true }).fill('alex+quote@example.test');
  await page
    .getByLabel(messageLabel(site, first), { exact: true })
    .fill('Keep this inquiry\nwith its second line.');
  await switchLanguage(page, site, second!);
  await expect(page).toHaveURL(`${contactPath(site, second!)}?utm_source=locale-test#inquiry`);
  await expect(page.getByLabel(form(site, second!).fullName, { exact: true })).toHaveValue(
    'Alex Buyer',
  );
  await expect(page.getByLabel(form(site, second!).email, { exact: true })).toHaveValue(
    'alex+quote@example.test',
  );
  await expect(page.getByLabel(messageLabel(site, second!), { exact: true })).toHaveValue(
    'Keep this inquiry\nwith its second line.',
  );
  await switchLanguage(page, site, first);
  await expect(page.getByLabel(form(site, first).fullName, { exact: true })).toHaveValue(
    'Alex Buyer',
  );
});

test('theme and granular consent persist, reopen withdraws and cross-tab changes sync', async ({
  page,
  context,
  site,
}) => {
  const first = homeLocale(site);
  const other = secondLocale(site) ?? first;
  const t = site.messages(first);
  const siblingTitle = site.messages(other).cookie.title;
  await page.goto('/');
  await page.getByRole('button', { name: t.cookie.customize, exact: true }).click();
  await page.getByRole('checkbox', { name: t.cookie.analytics, exact: true }).check();
  await page.getByRole('button', { name: t.cookie.saveChoices, exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cookie-consent')!).consent),
  ).toEqual({ necessary: true, analytics: true, advertising: false });
  await themeButton(page, site, first, 'dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('region', { name: t.cookie.title })).toBeHidden();
  const sibling = await context.newPage();
  await sibling.goto(site.pathFor(other, 'home'));
  await page.getByRole('button', { name: t.cookie.settings }).click();
  await expect(page.getByRole('region', { name: t.cookie.title })).toBeVisible();
  await expect(sibling.getByRole('region', { name: siblingTitle })).toBeVisible();
  await page.getByRole('button', { name: t.cookie.rejectAll, exact: true }).click();
  await expect(sibling.getByRole('region', { name: siblingTitle })).toBeHidden();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cookie-consent')!).consent),
  ).toEqual({ necessary: true, analytics: false, advertising: false });
  await themeButton(page, site, first, 'system').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(0);
  await sibling.close();
});

test('every language submits to the real Action and requires fresh verification', async ({
  page,
  site,
}) => {
  for (const locale of site.locales) {
    const f = form(site, locale);
    const submit = page.getByRole('button', { name: f.submit, exact: true });
    await page.goto(contactPath(site, locale));
    await dismissConsent(page, site);
    await page.getByLabel(f.fullName, { exact: true }).fill('Browser Buyer');
    await page.getByLabel(f.email, { exact: true }).fill('browser+fixture@example.test');
    await page
      .getByLabel(messageLabel(site, locale), { exact: true })
      .fill('Actual browser → Astro Action → mocked provider boundaries.');
    const request = page.waitForRequest(
      (request) => request.url().includes('/_actions/inquiry') && request.method() === 'POST',
    );
    await submit.click();
    expect(JSON.parse((await request).postData()!).fullName).toBe('Browser Buyer');
    await expect(page.locator('[data-form-status]')).toContainText('INQ-');
    await expect(page.locator('[data-form-status] strong')).toHaveText(f.statusPrefix.success);
    await expect(page.locator('[data-form-status]')).toHaveAttribute('data-state', 'success');
    expect(await calloutColors(page)).toEqual(await toneColors(page, 'success'));
    await expect(page.getByLabel(f.fullName, { exact: true })).toHaveValue('');
    await expect(submit).toBeDisabled();
    await page.getByRole('button', { name: '[Test] Complete verification', exact: true }).click();
    await expect(submit).toBeEnabled();
    await page.evaluate(() =>
      (window as unknown as { __turnstileOptions: Record<string, () => void> }).__turnstileOptions[
        'expired-callback'
      ]!(),
    );
    await expect(submit).toBeDisabled();
    await expect(page.locator('[data-verification-status]')).toContainText(f.turnstile.expired);
  }
});

test('native validation keeps fields; verification load failure is explained without bypass', async ({
  page,
  site,
}) => {
  const f = form(site, homeLocale(site));
  await page.goto(contactPath(site, homeLocale(site)));
  await dismissConsent(page, site);
  await page.getByLabel(f.email, { exact: true }).fill('not-an-email');
  await page.getByRole('button', { name: f.submit, exact: true }).click();
  await expect(page.getByText(f.errors.fullName.required, { exact: true })).toBeVisible();
  await expect(page.getByText(f.errors.email.invalid, { exact: true })).toBeVisible();
  await expect(page.getByLabel(f.email, { exact: true })).toHaveValue('not-an-email');
  await page.unroute('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) => route.abort(),
  );
  await page.reload();
  await expect(page.locator('[data-verification-status]')).toHaveText(f.turnstile.loadFailed);
  await expect(page.getByRole('button', { name: f.submit, exact: true })).toBeDisabled();
});

test('no-JS content, legal links, and secure fallback remain readable', async ({
  browser,
  baseURL,
  site,
}) => {
  const locale = secondLocale(site) ?? homeLocale(site);
  const f = form(site, locale);
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto(contactPath(site, locale));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    site.pageContent(locale, 'contact').metadata.title,
  );
  // Playwright's text engine deliberately skips noscript descendants even when
  // scripting is disabled; assert the actual rendered fallback element instead.
  await expect(page.locator('noscript .fallback')).toHaveText(f.noJsExplanation);
  await expect(page.locator('noscript .fallback')).toBeVisible();
  await expect(page.getByRole('button', { name: f.submit })).toBeDisabled();
  // Nothing claims the check is broken, and the no-JS notice comes before the fields.
  await expect(page.locator('[data-verification-status]')).toHaveText('');
  expect(
    await page
      .locator('noscript:has(.fallback)')
      .first()
      .evaluate((notice) =>
        Boolean(
          notice.compareDocumentPosition(document.querySelector('form[data-inquiry-form]')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
  ).toBe(true);
  // Script-only footer controls are not offered when they cannot work.
  await expect(
    page.getByRole('button', { name: site.messages(locale).cookie.settings }),
  ).toBeHidden();
  await expect(page.locator('[data-theme-switcher]')).toBeHidden();
  // Like the reference site, a visit without scripts is shown light.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // Without the form, a configured mailbox is the way to reach the business.
  const email = site.site.contact.email;
  if (email)
    await expect(
      page.getByRole('region', { name: f.contactAriaLabel }).getByRole('link', { name: email }),
    ).toHaveAttribute('href', `mailto:${email}`);
  else await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  // The language menu and the phone menu still open as native disclosures.
  const t = site.messages(locale);
  if (site.locales.length > 1) {
    await languageTrigger(page, site, locale).click();
    await expect(languageLink(page, site, homeLocale(site))).toBeVisible();
    await languageTrigger(page, site, locale).click();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('banner').locator('[data-mobile-fallback] > summary').click();
  const phoneMenu = page.getByRole('navigation', { name: t.accessibility.mobileNavigation });
  await expect(
    phoneMenu.getByRole('link', { name: t.navigation.contactSales, exact: true }),
  ).toBeVisible();
  await page.getByRole('banner').locator('[data-mobile-fallback] > summary').click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .getByRole('link', { name: site.messages(locale).footer.sections.support.privacy, exact: true })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    site.pageContent(locale, 'privacy').metadata.title,
  );
  await context.close();
});

test('contact pages reflow on phones without horizontal scrolling', async ({ page, site }) => {
  // 320px is the WCAG 1.4.10 reflow width; the fixture widget is as wide as real Turnstile.
  for (const locale of site.locales) {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(contactPath(site, locale));
    await dismissConsent(page, site);
    await expect(page.getByRole('button', { name: '[Test] Complete verification' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  const t = site.messages(homeLocale(site));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(contactPath(site, homeLocale(site)));
  await dismissConsent(page, site);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const { privacy, terms } = t.footer.sections.support;
  await expect(page.locator('.privacy-notice')).toHaveText(
    t.inquiry.form.privacyNotice.replace('{privacy}', privacy).replace('{terms}', terms),
  );
  const legalLinks = { '{privacy}': privacy, '{terms}': terms };
  await expect(page.locator('.privacy-notice a')).toHaveText(
    t.inquiry.form.privacyNotice
      .match(/\{privacy\}|\{terms\}/g)!
      .map((placeholder) => legalLinks[placeholder as keyof typeof legalLinks]),
  );
  // In-site links and buttons carry no external-link arrow; only new-tab social links do.
  await expect(page.locator('[data-submit]')).toHaveText(t.inquiry.form.submit);
});

test('a long company email fits phone widths, the widget fits its column, and the contact details come before the form', async ({
  page,
  site,
}) => {
  await withLongCompanyEmail(page, site);
  for (const width of [320, 375]) {
    for (const locale of site.locales) {
      const path = contactPath(site, locale);
      await page.setViewportSize({ width, height: 812 });
      await page.goto(path);
      await dismissConsent(page, site);
      await expect(page.locator('.contact-methods a')).toHaveText(longEmail);
      await expect(page.locator('[data-turnstile] button')).toHaveCount(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${path} at ${width}px`,
      ).toBe(true);
      // The 300px widget only when its column fits it; compact on narrower phones (320px).
      const slot = await page
        .locator('[data-turnstile]')
        .evaluate((element) => element.clientWidth);
      const size = await page.evaluate(
        () =>
          (window as unknown as { __turnstileOptions: { size?: string } }).__turnstileOptions.size,
      );
      expect(size, `${path} at ${width}px, ${slot}px column`).toBe(
        slot < 300 ? 'compact' : undefined,
      );
      if (width === 320) expect(size).toBe('compact');
    }
  }
  // Phone: page text, then the contact details, then the form; Tab follows the same order.
  const f = form(site, homeLocale(site));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(contactPath(site, homeLocale(site)));
  await dismissConsent(page, site);
  const fullName = page.getByLabel(f.fullName, { exact: true });
  const detailsEmail = page.locator('.contact-methods a');
  const title = page.getByRole('heading', { level: 1 });
  expect((await title.boundingBox())!.y).toBeLessThan((await detailsEmail.boundingBox())!.y);
  expect((await detailsEmail.boundingBox())!.y).toBeLessThan((await fullName.boundingBox())!.y);
  const order: string[] = [];
  for (let presses = 0; presses < 40 && order.length < 2; presses++) {
    await page.keyboard.press('Tab');
    if (await fullName.evaluate((field) => field === document.activeElement)) order.push('form');
    if (await detailsEmail.evaluate((link) => link === document.activeElement))
      order.push('details');
  }
  expect(order).toEqual(['details', 'form']);
  // Wide screens: text and details on the left, the form on the right, both starting at the top.
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await detailsEmail.boundingBox())!.x).toBeLessThan((await fullName.boundingBox())!.x);
  const formTop = (await page.locator('#inquiry').boundingBox())!.y;
  expect(Math.abs(formTop - (await title.boundingBox())!.y)).toBeLessThan(2);
});

test('the sticky header marks the current page, offers contact as a button, and links and buttons react to hover', async ({
  page,
  site,
}) => {
  const locale = homeLocale(site);
  const t = site.messages(locale);
  const look = (target: ReturnType<Page['locator']>) =>
    target.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: window.rgba(style.color).join(), underline: style.textDecorationLine };
    });
  await page.goto(site.pathFor(locale, 'home'));
  await dismissConsent(page, site);
  await page.mouse.move(0, 0);
  await settled(page);
  const current = { color: await tokenColor(page, '--foreground'), underline: 'none' };
  const other = { color: await tokenColor(page, '--muted-foreground'), underline: 'none' };
  expect(current.color).not.toBe(other.color);
  // Sticky like the reference site: 64px, a translucent background, and it stays on top.
  const banner = page.getByRole('banner');
  expect((await banner.boundingBox())!.height).toBe(65);
  expect(
    await banner.evaluate((header) => window.rgba(getComputedStyle(header).backgroundColor)[3]),
  ).toBeLessThan(255);
  await expect(banner).toHaveCSS('position', 'sticky');
  await expect(banner).toHaveCSS('top', '0px');
  await expect(banner).toHaveCSS('backdrop-filter', 'blur(12px)');
  // The current item is in the foreground colour, the others grey; nothing is underlined.
  const nav = page.getByRole('navigation', { name: t.accessibility.mainNavigation });
  const currentItem = nav.locator(':scope > ul > li > a[aria-current="page"]');
  await expect(currentItem).toHaveAttribute('href', site.pathFor(locale, 'home'));
  expect(await look(currentItem)).toEqual(current);
  const otherItems = await nav
    .locator(':scope > ul > li > :is(a, button):not([aria-current])')
    .all();
  for (const item of otherItems) {
    const name = (await item.textContent())!.trim();
    expect(await look(item), name).toEqual(other);
    // Hover darkens the text without an underline, and the current item turns grey so only
    // one item is highlighted at a time.
    await item.hover();
    await settled(page);
    expect(await look(item), `${name} hovered`).toEqual(current);
    expect(await look(currentItem), `current while ${name} is hovered`).toEqual(other);
    await page.mouse.move(0, 300);
    await page.keyboard.press('Escape');
    await settled(page);
  }
  // Contact is the brand-coloured button, not a navigation link.
  const cta = banner.getByRole('link', { name: t.navigation.contactSales, exact: true });
  await expect(cta).toHaveAttribute('href', contactPath(site, locale));
  await expect(
    nav.locator(`:scope > ul > li > a[href="${contactPath(site, locale)}"]`),
  ).toHaveCount(0);
  expect(
    await cta.evaluate((link) => window.rgba(getComputedStyle(link).backgroundColor).join()),
  ).toBe(await tokenColor(page, '--button-primary-bg'));
  expect((await cta.boundingBox())!.height).toBe(32);
  if (site.locales.length > 1) {
    const trigger = languageTrigger(page, site, locale);
    expect(await look(trigger)).toEqual(other);
    await trigger.hover();
    await settled(page);
    expect(await look(trigger)).toEqual(current);
    await page.mouse.move(0, 300);
  }
  // A configured logo gives hover feedback without an underline.
  const brand = banner.locator('a.brand');
  if (await brand.count()) {
    await brand.hover();
    expect((await look(brand)).underline).toBe('none');
  }

  const contrast = (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const luminance = (color: string) => {
        const channels = window
          .rgba(color)
          .slice(0, 3)
          .map((value) => {
            const channel = Number(value) / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const style = getComputedStyle(element);
      const [light, dark] = [luminance(style.color), luminance(style.backgroundColor)].sort(
        (a, b) => b - a,
      );
      return { background: style.backgroundColor, ratio: (light! + 0.05) / (dark! + 0.05) };
    });
  const home = site.pathFor(locale, 'home');
  await page.goto(`${home === '/' ? '' : home}/missing-offering`);
  for (const theme of ['light', 'dark']) {
    await themeButton(page, site, locale, theme as Theme).click();
    for (const name of [t.errors.notFound.goHome, t.footer.sections.navigation.contact]) {
      const button = page.locator('main').getByRole('link', { name, exact: true });
      await page.mouse.move(0, 0);
      await settled(page);
      const resting = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
      await button.hover();
      await settled(page);
      const hovered = await contrast(`.not-found-actions a:hover`);
      expect(hovered.background, `${theme} ${name}`).not.toBe(resting);
      expect(hovered.ratio, `${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('a first visit is light even on a dark system; the system and dark choices persist', async ({
  page,
  site,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(site.pathFor(homeLocale(site), 'home'));
  const html = page.locator('html');
  const pressed = async () => {
    const result: string[] = [];
    for (const theme of ['system', 'light', 'dark'] as const)
      if (
        (await themeButton(page, site, homeLocale(site), theme).getAttribute('aria-pressed')) ===
        'true'
      )
        result.push(theme);
    return result;
  };
  const background = () =>
    page.evaluate(() => window.rgba(getComputedStyle(document.documentElement).backgroundColor));
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await pressed()).toEqual(['light']);
  const light = await background();
  await themeButton(page, site, homeLocale(site), 'system').click();
  await expect(html).not.toHaveAttribute('data-theme');
  expect(await background()).not.toEqual(light);
  await page.reload();
  await expect(html).not.toHaveAttribute('data-theme');
  expect(await pressed()).toEqual(['system']);
  await themeButton(page, site, homeLocale(site), 'dark').click();
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await pressed()).toEqual(['dark']);
});

test('footer links are grey without an underline and darken on hover; in-content links keep a grey underline', async ({
  page,
  site,
}) => {
  const locale = homeLocale(site);
  const t = site.messages(locale);
  await page.goto(contactPath(site, locale));
  await dismissConsent(page, site);
  await page.mouse.move(0, 0);
  await settled(page);
  const foreground = await tokenColor(page, '--foreground');
  const grey = await tokenColor(page, '--muted-foreground');
  const look = (target: ReturnType<Page['locator']>) =>
    target.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: window.rgba(style.color).join(),
        underline: style.textDecorationLine,
        decoration: window.rgba(style.textDecorationColor).join(),
      };
    });
  const footer = page.getByRole('contentinfo');
  const footerControls = [
    ...(await footer.getByRole('link').all()),
    footer.getByRole('button', { name: t.cookie.settings, exact: true }),
  ];
  expect(footerControls.length).toBeGreaterThan(2);
  for (const control of footerControls) {
    const name = (await control.textContent())!.trim();
    expect(await look(control), name).toMatchObject({ color: grey, underline: 'none' });
    await control.hover();
    await settled(page);
    expect(await look(control), `${name} hovered`).toMatchObject({
      color: foreground,
      underline: 'none',
    });
    await page.mouse.move(0, 0);
    await settled(page);
  }
  // Links inside sentences are foreground text with a lighter underline that darkens on hover.
  const inContent = page.locator('.privacy-notice a').first();
  const resting = await look(inContent);
  expect(resting).toMatchObject({ color: foreground, underline: 'underline' });
  expect(resting.decoration).not.toBe(foreground);
  await inContent.hover();
  await settled(page);
  expect(await look(inContent)).toMatchObject({ underline: 'underline', decoration: foreground });
});

test('contact details hold a heading and the configured links only, and the form has no card or title', async ({
  page,
  site,
}) => {
  const { contact } = site.site;
  const configured =
    Boolean(contact.email || contact.phone || contact.whatsapp) ||
    Object.values(site.site.company?.location ?? {}).some(Boolean);
  for (const locale of site.locales) {
    const t = site.messages(locale);
    await page.goto(contactPath(site, locale));
    const details = page.getByRole('region', { name: t.contact.panel.contactTitle, exact: true });
    await expect(details).toHaveCount(configured ? 1 : 0);
    // No lead-in sentence: the heading first, then only links and the address.
    if (configured)
      expect(
        await details.evaluate(
          (section) =>
            section.children[0]?.tagName === 'H2' &&
            [...section.children].slice(1).every((child) => /^(A|ADDRESS)$/.test(child.tagName)),
        ),
      ).toBe(true);
    const inquiry = page.getByRole('region', { name: t.inquiry.form.contactAriaLabel });
    await expect(inquiry.getByRole('heading')).toHaveCount(0);
    expect(
      await inquiry.evaluate((section) => {
        const style = getComputedStyle(section);
        return [style.borderTopStyle, style.backgroundColor, style.paddingTop];
      }),
    ).toEqual(['none', 'rgba(0, 0, 0, 0)', '0px']);
  }
});

test('long words in headings wrap at 320px instead of widening the page', async ({
  page,
  site,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const locale of site.locales) {
    for (const [key, level] of [
      ['home', 1],
      ['contact', 1],
    ] as const) {
      const path = site.pathFor(locale, key);
      await page.goto(path);
      await dismissConsent(page, site);
      await page
        .getByRole('heading', { level })
        .first()
        .evaluate((heading) => (heading.textContent = 'Telecomunicaciones industriales'));
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        path,
      ).toBe(true);
    }
  }
});

test('security check reads as loading, then stays quiet while the challenge waits', async ({
  page,
  site,
}) => {
  for (const locale of site.locales) {
    const { turnstile } = form(site, locale);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.unroute('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    await page.route(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
      async (route) => {
        await held;
        await route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: pendingWidgetScript,
        });
      },
    );
    // The held widget script delays the load event; the page is usable once parsed.
    await page.goto(contactPath(site, locale), { waitUntil: 'domcontentloaded' });
    const status = page.locator('[data-verification-status]');
    await expect(status).toContainText(turnstile.loading);
    const colour = () =>
      status.evaluate((note) => window.rgba(getComputedStyle(note).color).join());
    expect(await colour()).toBe(await tokenColor(page, '--muted-foreground'));
    release();
    await expect.poll(() => page.evaluate(() => '__turnstileOptions' in window)).toBe(true);
    await expect(status).toHaveText('');
    await expect(page.locator('[data-submit]')).toBeDisabled();
    await page.evaluate(() =>
      (window as unknown as { __turnstileOptions: Record<string, () => void> }).__turnstileOptions[
        'error-callback'
      ]!(),
    );
    await expect(status).toContainText(turnstile.unavailable);
    // Failure reads in the error colour, keeping the specific next step in the wording.
    expect(await colour()).toBe(await tokenColor(page, '--error-foreground'));
  }
});

test('on a phone, every Tab stop up to the footer stays clear of the open cookie card', async ({
  page,
  site,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const first = homeLocale(site);
  for (const [locale, key] of [
    [first, 'contact'],
    ...site.locales.slice(1).map((locale) => [locale, 'contact'] as const),
    [first, 'privacy'],
  ] as const) {
    const path = site.pathFor(locale, key);
    await page.goto(path);
    const banner = page.getByRole('region', { name: site.messages(locale).cookie.title });
    await expect(banner).toBeVisible();
    // A person sees a rendered frame before pressing Tab; headless navigation may not have one yet.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const stops: string[] = [];
    let reachedFooterEnd = false;
    for (let step = 0; step < 80; step++) {
      await page.keyboard.press('Tab');
      // SC 2.4.11 Minimum: no control may be entirely hidden. Single-line controls must be fully
      // clear; the tall message box only scrolls far enough to show part of itself.
      const stop = await page.evaluate(() => {
        const card = document.querySelector('[data-cookie-banner]')!.getBoundingClientRect();
        const focused = document.activeElement as HTMLElement | null;
        if (!focused || focused === document.body) return null;
        if (focused.closest('[data-cookie-banner]')) return { inCard: true } as const;
        const rect = focused.getBoundingClientRect();
        const covered = Math.max(
          0,
          Math.min(rect.bottom, card.bottom) - Math.max(rect.top, card.top),
        );
        return {
          inCard: false,
          name: `${focused.tagName} ${focused.getAttribute('aria-label') || focused.getAttribute('name') || focused.textContent?.trim()}`,
          clear: focused.tagName === 'TEXTAREA' ? covered < rect.height : covered === 0,
        } as const;
      });
      if (!stop) continue;
      if (stop.inCard) break;
      // The footer ends with the theme switcher; its last button is the dark theme.
      reachedFooterEnd = stop.name === `BUTTON ${site.messages(locale).theme.dark}`;
      if (!stop.clear) stops.push(stop.name);
    }
    expect(reachedFooterEnd, `${path} Tab reached the footer theme switcher`).toBe(true);
    expect(stops, `${path} focus stops hidden by the cookie card`).toEqual([]);
  }
});

test('the cookie card stays on screen at 400% zoom and in landscape, scrolling inside itself', async ({
  page,
  site,
}) => {
  for (const [width, height] of [
    [320, 256],
    [568, 320],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const locale of site.locales) {
      const path = contactPath(site, locale);
      const { cookie } = site.messages(locale);
      await page.goto(path);
      const banner = page.locator('[data-cookie-banner]');
      await banner.getByRole('button', { name: cookie.customize, exact: true }).click();
      // The card rises 0.5rem as it enters; measure where it comes to rest.
      await settled(page);
      const box = (await banner.boundingBox())!;
      expect(box.y, `${path} at ${width}x${height} card top`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      // The privacy link a visitor is consenting under can be reached and seen.
      const link = banner.getByRole('link', { name: cookie.learnMore, exact: true });
      await link.focus();
      const linkBox = (await link.boundingBox())!;
      expect(linkBox.y, `${path} at ${width}x${height} link`).toBeGreaterThanOrEqual(0);
      expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(height);
    }
  }
});

test('Customize sits on the left but is reached last, and Tab moves straight into the options it reveals', async ({
  page,
  site,
}) => {
  for (const locale of site.locales) {
    const { cookie } = site.messages(locale);
    await page.goto(site.pathFor(locale, 'home'));
    const button = page.getByRole('button', { name: cookie.customize, exact: true });
    // Shown first, like the reference site, while Reject all and Allow all share the right side.
    const [customizeBox, rejectBox, allowBox] = await Promise.all(
      [
        button,
        page.getByRole('button', { name: cookie.rejectAll, exact: true }),
        page.getByRole('button', { name: cookie.acceptAll, exact: true }),
      ].map(async (control) => (await control.boundingBox())!),
    );
    expect(customizeBox.x + customizeBox.width).toBeLessThan(rejectBox.x);
    expect(rejectBox.x + rejectBox.width).toBeLessThan(allowBox.x);
    expect(Math.abs(rejectBox.width - allowBox.width)).toBeLessThanOrEqual(1);
    const collapsed = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    // The expanded state is visible, not only announced.
    expect(await button.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      collapsed,
    );
    for (const label of [cookie.analytics, cookie.advertising, cookie.saveChoices]) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(
          () => document.activeElement?.closest('label, button')?.textContent?.trim() ?? '',
        ),
      ).toBe(label);
    }
  }
});

test('the cookie card has no visible title, hugs the phone edge and floats from 640px', async ({
  page,
  site,
}) => {
  const locale = homeLocale(site);
  const { cookie } = site.messages(locale);
  for (const [width, place] of [
    [375, 'edge'],
    [800, 'right'],
    [1280, 'left'],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(site.pathFor(locale, 'privacy'));
    // Named for assistive tech by its label only; no heading takes up a line.
    const banner = page.getByRole('region', { name: cookie.title });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('heading')).toHaveCount(0);
    await settled(page);
    const box = (await banner.boundingBox())!;
    const borders = await banner.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopWidth, style.borderLeftWidth];
    });
    // The page width without a scrollbar, which fixed overlays are laid out against.
    const pageWidth = await page.evaluate(() => document.documentElement.clientWidth);
    if (place === 'edge') {
      // Full width on the bottom edge, with only a top border.
      expect(box).toMatchObject({ x: 0, width: pageWidth });
      expect(box.y + box.height).toBe(800);
      expect(borders).toEqual(['1px', '0px']);
    } else {
      expect(box.width).toBe(480);
      expect(box.y + box.height).toBe(780);
      expect(borders).toEqual(['1px', '1px']);
      if (place === 'right') expect(box.x + box.width).toBe(pageWidth - 20);
      else expect(box.x).toBe(20);
    }
  }
});

test('the language pill offers the browser language once consent is settled, switches equivalently and stays dismissed', async ({
  browser,
  baseURL,
  site,
}) => {
  const [first, second] = [homeLocale(site), secondLocale(site)];
  test.skip(!second, 'single-language site: nothing to suggest');
  const context = await browser.newContext({ baseURL, locale: first });
  const page = await context.newPage();
  await installColorProbe(page);
  const suggested = site.messages(first).languageSuggestion;
  const pill = page.getByRole('region', { name: suggested.label });
  const cookie = site.messages(second!).cookie;
  await page.goto(`${contactPath(site, second!)}?utm_source=pill#inquiry`);
  // Never together with the cookie card: it waits for the consent choice.
  await expect(page.getByRole('region', { name: cookie.title })).toBeVisible();
  await expect(pill).toBeHidden();
  await page.getByRole('button', { name: cookie.rejectAll, exact: true }).click();
  // Written in the language it offers.
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute('lang', first);
  await expect(pill).toContainText(suggested.message);
  // Reopening cookie settings hides it again until the visitor chooses.
  await page.getByRole('button', { name: cookie.settings, exact: true }).click();
  await expect(pill).toBeHidden();
  await page.getByRole('button', { name: cookie.rejectAll, exact: true }).click();
  await expect(pill).toBeVisible();
  // Centred at the bottom of the viewport.
  await settled(page);
  const box = (await pill.boundingBox())!;
  const viewport = page.viewportSize()!;
  const pageWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(Math.abs(box.x + box.width / 2 - pageWidth / 2)).toBeLessThanOrEqual(1);
  expect(box.y + box.height).toBe(viewport.height - 20);
  // Switching keeps the equivalent page, query and hash, and is remembered.
  await pill.getByRole('link', { name: suggested.switchAction, exact: true }).click();
  await expect(page).toHaveURL(`${contactPath(site, first)}?utm_source=pill#inquiry`);
  await expect(pill).toHaveCount(0);
  const back = site.messages(second!).languageSuggestion;
  await page.goto(contactPath(site, second!));
  await expect(page.getByRole('region', { name: back.label })).toHaveCount(0);
  await expect(pill).toBeVisible();
  // Dismissing keeps the current language and the pill stays away after a reload.
  await pill.getByRole('button', { name: suggested.dismiss, exact: true }).click();
  await expect(pill).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(pill).toBeHidden();
  await context.close();
});

test('dismissing the language pill holds for the page when storage refuses writes', async ({
  browser,
  baseURL,
  site,
}) => {
  const [first, second] = [homeLocale(site), secondLocale(site)];
  test.skip(!second, 'single-language site: nothing to suggest');
  const context = await browser.newContext({ baseURL, locale: first });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage disabled', 'SecurityError');
    };
  });
  const suggested = site.messages(first).languageSuggestion;
  const pill = page.getByRole('region', { name: suggested.label });
  const cookie = site.messages(second!).cookie;
  await page.goto(site.pathFor(second!, 'privacy'));
  await page.getByRole('button', { name: cookie.rejectAll, exact: true }).click();
  await expect(pill).toBeVisible();
  await pill.getByRole('button', { name: suggested.dismiss, exact: true }).click();
  await expect(pill).toBeHidden();
  // Reopening and settling cookie settings re-syncs the pill; the dismissal still holds.
  await page.getByRole('button', { name: cookie.settings, exact: true }).click();
  await page.getByRole('button', { name: cookie.rejectAll, exact: true }).click();
  await expect(pill).toBeHidden();
  await context.close();
});

test('choosing a language in the header is remembered, so the pill does not offer the one just left', async ({
  browser,
  baseURL,
  site,
}) => {
  const [first, second] = [homeLocale(site), secondLocale(site)];
  test.skip(!second, 'single-language site: nothing to suggest');
  const context = await browser.newContext({ baseURL, locale: first });
  const page = await context.newPage();
  await installColorProbe(page);
  await page.goto(site.pathFor(first, 'privacy'));
  await dismissConsent(page, site);
  await languageLink(page, site, second!).click();
  await expect(page).toHaveURL(site.pathFor(second!, 'privacy'));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    page.getByRole('region', { name: site.messages(first).languageSuggestion.label }),
  ).toBeHidden();
  // A 404 has no equivalent page in another language, so nothing is offered there.
  await page.evaluate(() => localStorage.removeItem('preferred-locale'));
  await page.goto(`${site.pathFor(second!, 'home')}/missing-offering`);
  await expect(page.locator('[data-language-suggestion]')).toHaveCount(0);
  await context.close();
});

test('choosing after reopening cookie settings hands focus back to the footer control', async ({
  page,
  site,
}) => {
  for (const locale of site.locales) {
    const { cookie } = site.messages(locale);
    await page.goto(site.pathFor(locale, 'privacy'));
    await dismissConsent(page, site);
    const trigger = page.getByRole('button', { name: cookie.settings, exact: true });
    // Once with a quick choice, once through the expanded options.
    for (const finalChoice of [cookie.rejectAll, cookie.saveChoices]) {
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: cookie.customize, exact: true })).toBeFocused();
      if (finalChoice === cookie.saveChoices) {
        await page.keyboard.press('Enter');
        for (let step = 0; step < 3; step++) await page.keyboard.press('Tab');
      } else {
        for (let step = 0; step < 2; step++) await page.keyboard.press('Shift+Tab');
      }
      await expect(page.getByRole('button', { name: finalChoice, exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-cookie-banner]')).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  }
});

test('a pointer click that leaves focus on the page still hands focus back after a keyboard choice', async ({
  page,
  site,
}) => {
  const locale = homeLocale(site);
  const { cookie } = site.messages(locale);
  await page.goto(site.pathFor(locale, 'privacy'));
  await dismissConsent(page, site);
  const trigger = page.getByRole('button', { name: cookie.settings, exact: true });
  // Safari does not focus a clicked button, so the click arrives while focus is still on body.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await trigger.dispatchEvent('click');
  await expect(page.getByRole('button', { name: cookie.customize, exact: true })).toBeFocused();
  for (let step = 0; step < 2; step++) await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: cookie.rejectAll, exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-cookie-banner]')).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('the language menu opens on hover or click, checks the current language and closes on Escape; one language shows none', async ({
  page,
  site,
}) => {
  if (site.locales.length === 1) {
    // Nothing to switch to: no language menu and no lone language link.
    await page.goto(site.pathFor(homeLocale(site), 'home'));
    await expect(page.locator('[data-language-menu], .mobile-language')).toHaveCount(0);
    await expect(page.locator('[data-locale-link]')).toHaveCount(0);
    return;
  }
  const locale = secondLocale(site)!;
  const name = (language: Locale) => site.localeTable[language].name;
  await page.goto(contactPath(site, locale));
  await dismissConsent(page, site);
  const trigger = languageTrigger(page, site, locale);
  await expect(trigger).toHaveText(name(locale));
  const menu = page.locator('[data-language-menu]');
  const list = menu.getByRole('list', { name: site.messages(locale).navigation.language });
  await expect(list).toBeHidden();
  // Hover opens it at once with a fade and scale; leaving closes it.
  await trigger.hover();
  await expect(list).toBeVisible();
  const opening = await list.evaluate((panel) =>
    panel.getAnimations().map((animation) => (animation as CSSTransition).transitionProperty),
  );
  expect(opening).toEqual(expect.arrayContaining(['opacity', 'transform']));
  // The current language is marked and checked but is not a link; the others are links.
  const currentOption = list.locator('[aria-current="true"]');
  await expect(currentOption).toHaveText(name(locale));
  await expect(currentOption.locator('svg')).toHaveCount(1);
  for (const language of site.locales.filter((language) => language !== locale))
    await expect(languageLink(page, site, language)).toHaveAttribute('hreflang', language);
  await expect(list.getByRole('link')).toHaveCount(site.locales.length - 1);
  await page.mouse.move(0, 500);
  await expect(list).toBeHidden();
  // A click right after the hover keeps it open, also once the pointer leaves.
  await trigger.click();
  await expect(list).toBeVisible();
  await page.mouse.move(0, 500);
  await page.waitForTimeout(200);
  await expect(list).toBeVisible();
  await page.mouse.click(5, 500);
  await expect(list).toBeHidden();
  // Keyboard: Arrow Down opens and focuses the first language; Escape closes and returns.
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('link').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(trigger).toBeFocused();
  // Hover-open, then Arrow Down into the languages: leaving with the pointer keeps it open.
  await trigger.hover();
  await expect(list).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('link').first()).toBeFocused();
  await page.mouse.move(0, 500);
  await page.waitForTimeout(200);
  await expect(list).toBeVisible();
  await expect(list.getByRole('link').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(trigger).toBeFocused();
  // A press outside closes it.
  await page.keyboard.press('Enter');
  await expect(list).toBeVisible();
  await page.mouse.click(5, 500);
  await expect(list).toBeHidden();
});

test('the phone menu is a right-side drawer with navigation, the inquiry button and languages', async ({
  page,
  site,
}) => {
  const locale = homeLocale(site);
  const t = site.messages(locale);
  for (const [width, drawerWidth] of [
    [375, 320],
    [700, 360],
  ]) {
    await page.setViewportSize({ width: width!, height: 812 });
    await page.goto(site.pathFor(locale, 'home'));
    await dismissConsent(page, site);
    const banner = page.getByRole('banner');
    // The phone header keeps the inquiry button next to the menu button.
    await expect(
      banner.getByRole('link', { name: t.navigation.contactSales, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: t.accessibility.mainNavigation }),
    ).toBeHidden();
    const open = banner.getByRole('button', { name: t.accessibility.openMenu, exact: true });
    await open.click();
    const drawer = page.getByRole('dialog', { name: t.accessibility.mobileNavigation });
    await expect(drawer).toBeVisible();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(() => drawer.evaluate((dialog) => dialog.getBoundingClientRect().x))
      .toBe(width! - drawerWidth!);
    expect((await drawer.boundingBox())!.width).toBe(drawerWidth);
    // It slides in over 500ms and focus starts on the close button.
    const close = drawer.getByRole('button', { name: t.accessibility.closeMenu, exact: true });
    await expect(close).toBeFocused();
    const menu = drawer.getByRole('navigation', { name: t.accessibility.mobileNavigation });
    for (const entry of site.pages.filter(
      (item) => 'nav' in item && item.nav === 'main' && item.key !== 'contact',
    ))
      await expect(
        menu.locator(`:scope > ul > li > a[href="${site.pathFor(locale, entry.key)}"]`),
      ).toHaveCount(1);
    await expect(menu.locator('a[aria-current="page"]').first()).toHaveAttribute(
      'href',
      site.pathFor(locale, 'home'),
    );
    const cta = menu.getByRole('link', { name: t.navigation.contactSales, exact: true });
    expect((await cta.boundingBox())!.width).toBeGreaterThan(drawerWidth! - 40);
    // Focus stays inside the open drawer.
    for (let presses = 0; presses < 12; presses++) {
      await page.keyboard.press('Tab');
      expect(
        await drawer.evaluate((dialog) => dialog.contains(document.activeElement)),
        `Tab ${presses}`,
      ).toBe(true);
    }
    // The close button slides it out first, then closes and hands focus back.
    await close.click();
    await expect(drawer).toHaveAttribute('data-closing', '');
    await expect(drawer).toBeHidden();
    await expect(open).toBeFocused();
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    // Escape and a press on the dimmed page close it as well.
    await open.click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveAttribute('data-closing', '');
    await expect(drawer).toBeHidden();
    await open.click();
    await expect(close).toBeFocused();
    await page.mouse.click(10, 400);
    await expect(drawer).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow))
      .not.toBe('hidden');
  }
  // Languages collapse at the bottom; each one is a 44px row and the current one is checked.
  const second = secondLocale(site);
  if (second) {
    await page.setViewportSize({ width: 375, height: 812 });
    await openLanguages(page, site);
    const drawer = page.getByRole('dialog', { name: t.accessibility.mobileNavigation });
    const current = drawer.locator('[aria-current="true"]');
    await expect(current).toHaveText(site.localeTable[locale].name);
    expect((await current.boundingBox())!.height).toBe(44);
    expect((await languageLink(page, site, second).boundingBox())!.height).toBe(44);
    await languageLink(page, site, second).click();
    await expect(page).toHaveURL(site.pathFor(second, 'home'));
  }
});

test('configured submenus open as a full-width panel with keyboard support and collapse in the phone drawer', async ({
  page,
  site,
}) => {
  const [menu] = site.navMenus;
  test.skip(!menu, 'no submenu configured');
  const locale = homeLocale(site);
  const t = site.messages(locale);
  const labels = site.menuLabels(locale, menu!);
  const linkNames = menu!.groups.flatMap((group) =>
    group.links.map((link) =>
      'page' in link
        ? link.page === 'home'
          ? t.navigation.home
          : site.pageContent(locale, link.page as Exclude<typeof link.page, 'home'>).metadata.title
        : `${labels.links![link.key]} (${t.accessibility.opensInNewTab})`,
    ),
  );
  await page.goto(site.pathFor(locale, 'home'));
  await dismissConsent(page, site);
  const nav = page.getByRole('navigation', { name: t.accessibility.mainNavigation });
  const trigger = nav.getByRole('button', { name: labels.label, exact: true });
  const panel = page.locator(`#${await trigger.getAttribute('aria-controls')}`);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
  // Hover opens it after a short delay: full width under the header, grouped, page dimmed.
  await trigger.hover();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(page.viewportSize()!.width);
  expect(box.y).toBe((await page.getByRole('banner').boundingBox())!.height - 1);
  for (const group of menu!.groups)
    await expect(
      panel.getByRole('list', { name: labels.groups[group.key], exact: true }),
    ).toBeVisible();
  for (const name of linkNames)
    await expect(panel.getByRole('link', { name, exact: true })).toBeVisible();
  const external = panel.locator('a[target="_blank"]');
  for (const link of await external.all())
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const dim = await panel.evaluate(
    (element) => window.rgba(getComputedStyle(element, '::after').backgroundColor)[3]!,
  );
  expect(Math.abs(dim - 128)).toBeLessThanOrEqual(1);
  // Leaving closes it; a click toggles it; a press outside closes it.
  await page.mouse.move(5, 600);
  await expect(panel).toBeHidden();
  await trigger.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(5, 700);
  await expect(panel).toBeHidden();
  // Keyboard: Enter opens and focuses the first link, arrows and Home/End move within the
  // panel, Escape closes it and returns focus to the button.
  await trigger.focus();
  await page.keyboard.press('Enter');
  const links = panel.getByRole('link');
  await expect(links.first()).toBeFocused();
  if (linkNames.length > 1) {
    await page.keyboard.press('ArrowDown');
    await expect(links.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(links.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(links.first()).toBeFocused();
  }
  // With focus kept in the open panel, hovering another top-level item, the current page
  // included, highlights only that item.
  const color = (target: ReturnType<Page['locator']>) =>
    target.evaluate((element) => window.rgba(getComputedStyle(element).color).join());
  const foreground = await tokenColor(page, '--foreground');
  const muted = await tokenColor(page, '--muted-foreground');
  const topItems = await nav.locator(':scope > ul > li > :is(a, button)').all();
  for (const hovered of await nav.locator(':scope > ul > li > a').all()) {
    await hovered.hover();
    await settled(page);
    const name = (await hovered.textContent())!.trim();
    for (const item of topItems) {
      const same = await item.evaluate(
        (element, other) => element === other,
        await hovered.elementHandle(),
      );
      expect(
        await color(item),
        `${(await item.textContent())!.trim()} while ${name} is hovered`,
      ).toBe(same ? foreground : muted);
    }
    await expect(panel).toBeVisible();
    await expect(links.first()).toBeFocused();
  }
  await page.mouse.move(5, 700);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowDown');
  await expect(links.first()).toBeFocused();
  // Focus leaving the navigation closes the panel so it never covers what comes next.
  for (
    let presses = 0;
    presses <= linkNames.length && (await nav.evaluate((n) => n.contains(document.activeElement)));
    presses++
  )
    await page.keyboard.press('Tab');
  await expect(panel).toBeHidden();
  // Phone: the same links inside a collapsible section of the drawer.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: t.accessibility.openMenu, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: t.accessibility.mobileNavigation });
  const section = drawer.locator('details', { has: page.getByText(labels.label, { exact: true }) });
  await expect(section.getByRole('link').first()).toBeHidden();
  await section.locator('summary').click();
  for (const name of linkNames)
    await expect(section.getByRole('link', { name, exact: true })).toBeVisible();
});

test('every registered page is linked from its navigation, and content pages get the page shell', async ({
  page,
  site,
}) => {
  for (const locale of site.locales) {
    const t = site.messages(locale);
    await page.goto(site.pathFor(locale, 'home'));
    const main = page.getByRole('navigation', { name: t.accessibility.mainNavigation });
    const footer = page.getByRole('contentinfo');
    await expect(
      page.getByRole('banner').getByRole('link', { name: t.navigation.contactSales, exact: true }),
    ).toHaveAttribute('href', site.pathFor(locale, 'contact'));
    for (const entry of site.pages) {
      const { key } = entry;
      const href = site.pathFor(locale, key);
      const nav = 'nav' in entry ? entry.nav : undefined;
      const where = `${locale} ${key} ${nav ?? 'no nav'}`;
      // Contact is the header's button rather than a navigation link.
      await expect(main.locator(`:scope > ul > li > a[href="${href}"]`), where).toHaveCount(
        nav === 'main' && key !== 'contact' ? 1 : 0,
      );
      await expect(footer.locator(`a[href="${href}"]`), where).toHaveCount(nav ? 1 : 0);
    }
  }
  // Owner pages that are not legal text: a contents card when they have sections, no
  // last-updated line.
  const contentPages = site.pages.filter(({ kind }) => (kind as string) === 'content');
  for (const locale of site.locales)
    for (const { key } of contentPages) {
      const t = site.messages(locale);
      const content = site.pageContent(locale, key as Exclude<typeof key, 'home'>);
      const sections = [...content.content.matchAll(/^## (.+)$/gm)].length;
      await page.goto(site.pathFor(locale, key));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(content.metadata.title);
      await expect(
        page.getByRole('navigation', { name: t.legal.tableOfContents }).getByRole('link'),
      ).toHaveCount(sections);
      await expect(page.getByRole('main').locator('time')).toHaveCount(0);
    }
  // The template ships legal pages only; the derived fixture adds a content page.
  test.info().annotations.push({ type: 'content pages', description: String(contentPages.length) });
});

test('dark tokens match for the system preference and the explicit choice; main text pairs reach 4.5:1', async ({
  page,
  site,
}) => {
  await page.goto(site.pathFor(homeLocale(site), 'home'));
  // Every custom property the stylesheets declare on :root, as the page resolves it.
  const tokens = () =>
    page.evaluate(() => {
      const names = new Set<string>();
      for (const sheet of document.styleSheets)
        for (const rule of sheet.cssRules) {
          const rules = rule instanceof CSSMediaRule ? [...rule.cssRules] : [rule];
          for (const inner of rules)
            if (inner instanceof CSSStyleRule && inner.selectorText.includes(':root'))
              for (const name of inner.style) if (name.startsWith('--')) names.add(name);
        }
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [...names].sort().map((name) => [name, style.getPropertyValue(name).trim()]),
      );
    });
  const theme = (value?: string) =>
    page.evaluate((value) => {
      if (value) document.documentElement.dataset.theme = value;
      else delete document.documentElement.dataset.theme;
    }, value);
  const themes: Record<string, Record<string, string>> = {};
  for (const [name, scheme, choice] of [
    ['light (system)', 'light', undefined],
    ['light (chosen over a dark system)', 'dark', 'light'],
    ['dark (system)', 'dark', undefined],
    ['dark (chosen over a light system)', 'light', 'dark'],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await theme(choice);
    themes[name] = await tokens();
  }
  expect(Object.keys(themes['dark (system)']!).length).toBeGreaterThan(5);
  // The three token blocks must not drift apart: one edited, another forgotten.
  expect(themes['dark (system)']).toEqual(themes['dark (chosen over a light system)']);
  expect(themes['light (system)']).toEqual(themes['light (chosen over a dark system)']);
  expect(themes['dark (system)']).not.toEqual(themes['light (system)']);
  const ratios = await page.evaluate(
    (themes) => {
      const luminance = (token: string, color: string) => {
        const values = window.rgba(color);
        if (values[3]! < 255)
          throw new Error(
            `${token} resolves to non-opaque ${color}; contrast needs opaque colours`,
          );
        const channels = values.slice(0, 3).map((value) => {
          const channel = Number(value) / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const ratio = (tokens: Record<string, string>, a: string, b: string) => {
        const [light, dark] = [luminance(a, tokens[a]!), luminance(b, tokens[b]!)].sort(
          (x, y) => y - x,
        );
        return (light! + 0.05) / (dark! + 0.05);
      };
      const pairs = [
        ['--button-primary-fg', '--button-primary-bg'],
        ['--button-primary-fg', '--button-primary-hover-bg'],
        ['--foreground', '--background'],
        ['--muted-foreground', '--background'],
        ['--muted-foreground', '--card'],
        ['--muted-foreground', '--popover'],
        ['--success-foreground', '--success-muted'],
        ['--warning-foreground', '--warning-muted'],
        ['--error-foreground', '--error-muted'],
        ['--info-foreground', '--info-muted'],
        ['--theme-switch-icon', '--background'],
      ];
      const result = Object.entries(themes).flatMap(([name, tokens]) =>
        pairs.map(([text, background]) => ({
          pair: `${name} ${text} on ${background}`,
          ratio: ratio(tokens, text!, background!),
        })),
      );
      return result;
    },
    { light: themes['light (system)']!, dark: themes['dark (system)']! },
  );
  for (const { pair, ratio } of ratios)
    // Theme switcher icons are graphics, so they need 3:1 (WCAG 1.4.11), not text contrast.
    expect(ratio, pair).toBeGreaterThanOrEqual(pair.includes('--theme-switch-icon') ? 3 : 4.5);
  await test.info().attach('theme-token-contrast', {
    body: JSON.stringify(ratios, null, 2),
    contentType: 'application/json',
  });
});

test('the theme switcher shows the current theme and the header brand follows the logo configuration', async ({
  page,
  site,
}) => {
  for (const [index, locale] of site.locales.entries()) {
    const t = site.messages(locale);
    await page.goto(site.pathFor(locale, 'home'));
    await dismissConsent(page, site);
    const group = page.getByRole('group', { name: t.accessibility.themeSelector });
    const buttons = group.getByRole('button');
    await expect(buttons).toHaveCount(3);
    for (const [position, name] of [t.theme.system, t.theme.light, t.theme.dark].entries())
      await expect(buttons.nth(position)).toHaveAccessibleName(name);
    // The first language picks the theme; later ones show the choice it persisted.
    if (index === 0) await themeButton(page, site, locale, 'dark').click();
    await expect(group.getByRole('button', { pressed: true })).toHaveAccessibleName(t.theme.dark);
    await expect(group.getByRole('button', { pressed: false })).toHaveCount(2);
  }
  // The header never shows the site name; a configured logo stands alone and is inverted in
  // dark themes so a dark-on-light logo stays visible.
  const banner = page.getByRole('banner');
  // The brand slot holds the logo image only, never the site name as text.
  await expect(banner.locator('.header-left')).toHaveText('');
  const logo = banner.locator('.brand img');
  if (site.site.brandAssets.logo?.status === 'ready') {
    await expect(logo).toBeVisible();
    expect((await logo.boundingBox())!.height).toBe(32);
    await expect(logo).toHaveCSS('filter', 'invert(1)');
    await page
      .getByRole('combobox', {
        name: site.messages(site.locales.at(-1)!).accessibility.themeSelector,
      })
      .selectOption('light');
    await expect(logo).toHaveCSS('filter', 'none');
  } else await expect(logo).toHaveCount(0);
});

test('page shells put the description under the title, show no date, and give content and legal sections a contents card', async ({
  page,
  site,
}) => {
  for (const locale of site.locales)
    for (const { key, kind } of site.pages.filter(({ kind }) => kind !== 'home')) {
      const content = site.pageContent(locale, key as Exclude<typeof key, 'home'>);
      const sections = [...content.content.matchAll(/^## (.+)$/gm)].length;
      const toc = page.getByRole('navigation', {
        name: site.messages(locale).legal.tableOfContents,
      });
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(site.pathFor(locale, key));
        const main = page.getByRole('main');
        const title = main.getByRole('heading', { level: 1 });
        if (content.metadata.description) {
          const description = main.getByText(content.metadata.description, { exact: true });
          await expect(description).toBeVisible();
          expect((await description.boundingBox())!.y).toBeGreaterThan(
            (await title.boundingBox())!.y,
          );
        }
        // Like the reference site, no "last updated" line or date is shown.
        await expect(main.locator('time')).toHaveCount(0);
        // One 720px column (24px gutters), the contact page widening for its form.
        const column = await main.locator('.page-narrow').boundingBox();
        expect(column!.width).toBeLessThanOrEqual(kind === 'contact' && width >= 1024 ? 1080 : 720);
        if (kind === 'contact' || sections === 0) {
          await expect(toc).toHaveCount(0);
          continue;
        }
        await expect(toc.getByRole('link')).toHaveCount(sections);
        const card = (await toc.boundingBox())!;
        const text = (await main.locator('.prose').boundingBox())!;
        // Beside the text from 1024px, above it on phones.
        if (width >= 1024) expect(card.x).toBeGreaterThan(text.x + text.width - 1);
        else expect(card.y).toBeLessThan(text.y);
      }
    }
});

test('a page FAQ renders every answer as plain HTML and as FAQPage structured data', async ({
  page,
  site,
}) => {
  let pagesWithFaq = 0;
  for (const locale of site.locales)
    for (const { key } of site.pages.filter(({ key }) => key !== 'home')) {
      const faq = site.pageContent(locale, key as Exclude<typeof key, 'home'>).metadata.faq;
      await page.goto(site.pathFor(locale, key));
      const section = page.getByRole('region', { name: site.messages(locale).legal.faq });
      const graph: Array<Record<string, unknown>> = JSON.parse(
        await page.locator('script[type="application/ld+json"]').innerHTML(),
      )['@graph'];
      const structured = graph.find((node) => node['@type'] === 'FAQPage');
      if (!faq?.length) {
        await expect(section).toHaveCount(0);
        expect(structured).toBeUndefined();
        continue;
      }
      pagesWithFaq++;
      await expect(section.getByRole('heading', { level: 3 })).toHaveText(
        faq.map((item) => item.question),
      );
      // Not an accordion: every answer is on screen without any interaction.
      for (const item of faq)
        await expect(section.getByText(item.answer, { exact: true })).toBeVisible();
      await expect(section.locator('details, button')).toHaveCount(0);
      expect(structured!.mainEntity).toEqual(
        faq.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      );
    }
  // The template ships no FAQ; the derived fixture adds one to its About page.
  test.info().annotations.push({ type: 'pages with FAQ', description: String(pagesWithFaq) });
});

test('the home page is one 720px column with a 36px title and an underlined contact link', async ({
  page,
  site,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const locale of site.locales) {
    const t = site.messages(locale);
    await page.goto(site.pathFor(locale, 'home'));
    const main = page.getByRole('main');
    const title = main.getByRole('heading', { level: 1 });
    await expect(title).toHaveText(t.home.title);
    expect(await title.evaluate((h1) => getComputedStyle(h1).fontSize)).toBe('36px');
    expect((await main.locator('.page-narrow').boundingBox())!.width).toBeLessThanOrEqual(720);
    const contact = main.getByRole('link', { name: t.home.contactLink, exact: true });
    await expect(contact).toHaveAttribute('href', contactPath(site, locale));
    // A text link, not a filled button.
    expect(
      await contact.evaluate((link) => {
        const style = getComputedStyle(link);
        return [style.textDecorationLine, style.backgroundColor];
      }),
    ).toEqual(['underline', 'rgba(0, 0, 0, 0)']);
    await expect(main.getByRole('button')).toHaveCount(0);
  }
});

test('keyboard and assistive tech never reach the honeypot field', async ({ page, site }) => {
  const locale = homeLocale(site);
  const f = form(site, locale);
  await page.goto(contactPath(site, locale));
  await dismissConsent(page, site);
  const inquiry = page.locator('form[data-inquiry-form]');
  await expect(inquiry.getByRole('textbox', { name: f.website })).toHaveCount(0);
  const honeypot = page.locator('#website');
  await expect(honeypot).toHaveAttribute('tabindex', '-1');
  await expect(honeypot).toHaveAttribute('autocomplete', 'off');
  await expect(honeypot.locator('..')).toHaveAttribute('aria-hidden', 'true');

  await page.getByLabel(f.fullName, { exact: true }).focus();
  const privacy = inquiry.getByRole('link', {
    name: site.messages(locale).footer.sections.support.privacy,
  });
  const visited: string[] = [];
  for (let presses = 0; presses < 12; presses++) {
    await page.keyboard.press('Tab');
    visited.push(
      await page.evaluate(
        () => document.activeElement?.id || document.activeElement?.tagName || '',
      ),
    );
    if (await privacy.evaluate((link) => link === document.activeElement)) break;
  }
  expect(visited).toContain('message');
  expect(visited).not.toContain('website');
  await expect(privacy).toBeFocused();
});

test('session draft survives refresh and a legal-page round trip', async ({ page, site }) => {
  const locale = homeLocale(site);
  const f = form(site, locale);
  const t = site.messages(locale);
  await page.goto(contactPath(site, locale));
  await dismissConsent(page, site);
  await page.getByLabel(f.fullName, { exact: true }).fill('Persistent Buyer');
  await page.getByLabel(f.email, { exact: true }).fill('draft@example.test');
  await page
    .getByLabel(messageLabel(site, locale), { exact: true })
    .fill('Retain this unsent draft.');
  await page.reload();
  await expect(page.getByLabel(f.fullName, { exact: true })).toHaveValue('Persistent Buyer');
  await page
    .getByRole('link', { name: t.footer.sections.support.privacy, exact: true })
    .first()
    .click();
  await page.getByRole('link', { name: t.navigation.contactSales, exact: true }).click();
  await expect(page.getByLabel(f.email, { exact: true })).toHaveValue('draft@example.test');
  await expect(page.getByLabel(messageLabel(site, locale), { exact: true })).toHaveValue(
    'Retain this unsent draft.',
  );
  expect(
    await page.evaluate(() =>
      Object.keys(JSON.parse(sessionStorage.getItem('inquiry-draft')!)).sort(),
    ),
  ).toEqual(['email', 'fullName', 'message']);
  for (const [name, limit] of [
    ['fullName', 100],
    ['email', 254],
    ['message', 2000],
  ] as const) {
    await expect(page.locator(`[name="${name}"]`)).toHaveAttribute('maxlength', String(limit));
  }
  const second = secondLocale(site);
  if (!second) return;
  const longestMessage = 'M'.repeat(2000);
  await page.getByLabel(messageLabel(site, locale), { exact: true }).fill(longestMessage);
  await page.reload();
  await switchLanguage(page, site, second);
  await expect(page.getByLabel(messageLabel(site, second), { exact: true })).toHaveValue(
    longestMessage,
  );
});

test('pending submission locks buyer edits and duplicate Enter, then clears only confirmed data', async ({
  page,
  request,
  controlURL,
  site,
}) => {
  const locale = homeLocale(site);
  const f = form(site, locale);
  await request.post(controlURL, { data: { delay: 1500 } });
  await page.goto(contactPath(site, locale));
  await dismissConsent(page, site);
  await page.getByLabel(f.fullName, { exact: true }).fill('One Pending Buyer');
  await page.getByLabel(f.email, { exact: true }).fill('pending@example.test');
  const submissions: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/_actions/inquiry')) submissions.push(request.url());
  });
  await page.getByRole('button', { name: f.submit, exact: true }).click();
  await expect(page.getByRole('button', { name: f.submitting, exact: true })).toBeDisabled();
  // Screen readers hear the wait, and focus is kept on the announcement instead of the page body.
  await expect(page.locator('[data-form-status]')).toHaveText(f.submitting);
  await expect(page.locator('[data-form-status]')).toBeFocused();
  expect(await calloutColors(page)).toEqual(await toneColors(page, 'info'));
  await expect(page.getByLabel(f.fullName, { exact: true })).toBeDisabled();
  await expect(page.getByLabel(f.email, { exact: true })).toBeDisabled();
  await expect(page.getByLabel(messageLabel(site, locale), { exact: true })).toBeDisabled();
  await page.locator('[data-inquiry-form]').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  const second = secondLocale(site);
  if (second) {
    await switchLanguage(page, site, second);
    await expect(page).toHaveURL(contactPath(site, locale));
    await expect(page.locator('[data-form-status]')).toContainText(f.localePending);
  }
  await expect(page.locator('[data-form-status]')).toContainText('INQ-');
  expect(submissions).toHaveLength(1);
  const { calls } = await (await request.get(controlURL)).json();
  expect(calls.filter((call: { url: string }) => call.url.includes('api.resend.com'))).toHaveLength(
    1,
  );
  expect(
    calls.filter((call: { url: string }) => call.url.includes('api.airtable.com')),
  ).toHaveLength(1);
  await expect(page.getByLabel(f.fullName, { exact: true })).toBeEnabled();
  await expect(page.getByLabel(f.fullName, { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => sessionStorage.getItem('inquiry-draft'))).toBeNull();
});

test('unconfirmed delivery keeps draft and retries only after explicit buyer action with fresh token', async ({
  page,
  request,
  controlURL,
  site,
}) => {
  const locale = homeLocale(site);
  const f = form(site, locale);
  const submit = page.getByRole('button', { name: f.submit, exact: true });
  await request.post(controlURL, { data: { email: 'reject', airtable: 'reject' } });
  await page.goto(contactPath(site, locale));
  await dismissConsent(page, site);
  await page.getByLabel(f.fullName, { exact: true }).fill('Retry Buyer');
  await page.getByLabel(f.email, { exact: true }).fill('retry@example.test');
  await submit.click();
  await expect(page.locator('[data-form-status]')).toContainText(f.unknown);
  await expect(page.getByLabel(f.fullName, { exact: true })).toHaveValue('Retry Buyer');
  await expect(submit).toBeDisabled();
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('inquiry-draft')!).fullName),
  ).toBe('Retry Buyer');
  await request.post(controlURL, { data: { email: 'accept', airtable: 'reject' } });
  await page.getByRole('button', { name: '[Test] Complete verification', exact: true }).click();
  await submit.click();
  await expect(page.locator('[data-form-status]')).toContainText('INQ-');
  await expect(page.getByLabel(f.fullName, { exact: true })).toHaveValue('');
});

test('server canonical validation maps an email rejection to localized field and focus', async ({
  page,
  site,
}) => {
  const locale = secondLocale(site) ?? homeLocale(site);
  const f = form(site, locale);
  const email = page.getByLabel(f.email, { exact: true });
  await page.goto(contactPath(site, locale));
  await dismissConsent(page, site);
  await page.getByLabel(f.fullName, { exact: true }).fill('Valid Buyer');
  await email.fill('+buyer@example.test');
  await page.getByRole('button', { name: f.submit, exact: true }).click();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(f.errors.email.invalid, { exact: true })).toBeVisible();
  await expect(email).toBeFocused();
  await expect(page.locator('[data-form-status] strong')).toHaveText(f.statusPrefix.error);
  expect(await calloutColors(page)).toEqual(await toneColors(page, 'error'));
  await expect(email).toHaveValue('+buyer@example.test');
});

test('rate-limit cooldown blocks repeat submit until elapsed and still needs fresh token', async ({
  page,
  request,
  controlURL,
  site,
}) => {
  const locale = homeLocale(site);
  const f = form(site, locale);
  const submit = page.getByRole('button', { name: f.submit, exact: true });
  await page.clock.install();
  await request.post(controlURL, { data: { rateCount: 11, rateTtl: 60000 } });
  await page.goto(contactPath(site, locale));
  await dismissConsent(page, site);
  await page.getByLabel(f.fullName, { exact: true }).fill('Rate Buyer');
  await page.getByLabel(f.email, { exact: true }).fill('rate@example.test');
  await submit.click();
  await expect(page.locator('[data-form-status]')).toContainText(f.errors.rateLimitSummary);
  await page.getByRole('button', { name: '[Test] Complete verification', exact: true }).click();
  await expect(submit).toBeDisabled();
  await page.locator('[data-inquiry-form]').dispatchEvent('submit');
  const state = await (await request.get(controlURL)).json();
  expect(state.calls).toHaveLength(1);
  await page.clock.fastForward(60001);
  await expect(submit).toBeEnabled();
  await request.post(controlURL, { data: { rateCount: 1 } });
  await submit.click();
  await expect(page.locator('[data-form-status]')).toContainText('INQ-');
});

test('losing the real Action response after provider acceptance retains data and does not retry', async ({
  page,
  request,
  controlURL,
  site,
}) => {
  const locale = homeLocale(site);
  const f = form(site, locale);
  await page.goto(contactPath(site, locale));
  await dismissConsent(page, site);
  await page.getByLabel(f.fullName, { exact: true }).fill('Response Lost Buyer');
  await page.getByLabel(f.email, { exact: true }).fill('lost@example.test');
  let responsesDropped = 0;
  await page.route('**/_actions/inquiry', async (route) => {
    // Execute the actual Action fully, then simulate network loss. Do not forge
    // an Action success response or substitute the handler/schema.
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    responsesDropped++;
    await route.abort('connectionfailed');
  });
  await page.getByRole('button', { name: f.submit, exact: true }).click();
  await expect(page.locator('[data-form-status]')).toContainText(f.unknown);
  await expect(page.getByLabel(f.fullName, { exact: true })).toHaveValue('Response Lost Buyer');
  await expect(page.getByRole('button', { name: f.submit, exact: true })).toBeDisabled();
  const { calls } = await (await request.get(controlURL)).json();
  expect(
    calls.filter((call: { url: string }) => /api\.(resend|airtable)\.com/.test(call.url)),
  ).toHaveLength(2);
  expect(responsesDropped).toBe(1);
});

test('configured analytics uses real consent code: no optional tag before consent, clean URL, withdrawal', async ({
  page,
  site,
}) => {
  const t = site.messages(homeLocale(site));
  // Only public page configuration is varied as a fixture; unchanged built
  // consent code runs. No production readiness bypass is added to the app.
  await page.route('**/?*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = (await response.text())
      .replace(/\bdata-ga-id(?:="[^"]*")?/, 'data-ga-id="G-FIXTURE"')
      .replace('data-production="false"', 'data-production="true"');
    await route.fulfill({ response, body: html });
  });
  const optionalLoads: string[] = [];
  await page.route('https://www.googletagmanager.com/**', async (route) => {
    optionalLoads.push(route.request().url());
    await route.fulfill({
      contentType: 'application/javascript',
      body: '/* external analytics boundary fixture: no network */',
    });
  });
  await page.goto('/?private=not-for-analytics#hidden');
  expect(optionalLoads).toHaveLength(0);
  await page.getByRole('button', { name: t.cookie.customize, exact: true }).click();
  await page.getByRole('checkbox', { name: t.cookie.analytics, exact: true }).check();
  await page.getByRole('button', { name: t.cookie.saveChoices, exact: true }).click();
  await expect.poll(() => optionalLoads.length).toBe(1);
  const signals = await page.evaluate(() =>
    (window as unknown as { dataLayer: Array<IArguments> }).dataLayer.map((args) =>
      Array.from(args),
    ),
  );
  expect(signals).toContainEqual([
    'consent',
    'default',
    {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    },
  ]);
  expect(signals).toContainEqual([
    'consent',
    'update',
    {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    },
  ]);
  expect(JSON.stringify(signals)).not.toContain('private=');
  expect(JSON.stringify(signals)).not.toContain('#hidden');
  await page.evaluate(() => {
    document.cookie = '_ga=fixture; path=/';
  });
  await page.getByRole('button', { name: t.cookie.settings, exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as Record<string, unknown>)['ga-disable-G-FIXTURE'],
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('_ga=');
});

test('locale switch uses the current hash and query after an in-page navigation', async ({
  page,
  site,
}) => {
  const [first, second] = [homeLocale(site), secondLocale(site)];
  test.skip(!second, 'single-language site');
  await page.goto(contactPath(site, first));
  await dismissConsent(page, site);
  await page.getByLabel(form(site, first).fullName, { exact: true }).fill('Current Location Buyer');
  await page.getByLabel(form(site, first).email, { exact: true }).fill('current@example.test');
  await page.evaluate(() => {
    location.hash = 'inquiry';
  });
  await expect(page).toHaveURL(`${contactPath(site, first)}#inquiry`);
  await page.evaluate(() => history.replaceState(null, '', '?source=current#inquiry'));
  await switchLanguage(page, site, second!);
  await expect(page).toHaveURL(`${contactPath(site, second!)}?source=current#inquiry`);
  await expect(page.getByLabel(form(site, second!).fullName, { exact: true })).toHaveValue(
    'Current Location Buyer',
  );
  await expect(page.getByLabel(form(site, second!).email, { exact: true })).toHaveValue(
    'current@example.test',
  );
  await switchLanguage(page, site, first);
  await expect(page).toHaveURL(`${contactPath(site, first)}?source=current#inquiry`);
});

test('active inquiry field boundaries have at least 3:1 contrast in both themes', async ({
  page,
  site,
}) => {
  const locale = homeLocale(site);
  await page.goto(contactPath(site, locale));
  await dismissConsent(page, site);
  const measurements = [];
  for (const theme of ['light', 'dark']) {
    await themeButton(page, site, locale, theme as Theme).click();
    for (const name of ['fullName', 'email', 'message']) {
      const field = page.locator(`[name="${name}"]`);
      await expect(field).toBeEditable();
      await field.fill(name === 'email' ? 'contrast@example.test' : 'Editable');
      await field.clear();
      const colors = await field.evaluate((element) => {
        const luminance = (color: string) => {
          const channels = window
            .rgba(color)
            .slice(0, 3)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
        };
        const style = getComputedStyle(element);
        // The form sits on the page itself, without a card.
        const surface = getComputedStyle(document.body);
        const border = luminance(style.borderColor);
        const contrast = (background: string) => {
          const adjacent = luminance(background);
          return (Math.max(border, adjacent) + 0.05) / (Math.min(border, adjacent) + 0.05);
        };
        return {
          border: style.borderColor,
          field: style.backgroundColor,
          page: surface.backgroundColor,
          fieldRatio: contrast(style.backgroundColor),
          pageRatio: contrast(surface.backgroundColor),
        };
      });
      measurements.push({ theme, name, ...colors });
      expect(colors.fieldRatio).toBeGreaterThanOrEqual(3);
      expect(colors.pageRatio).toBeGreaterThanOrEqual(3);
    }
  }
  await test.info().attach('active-field-contrast', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
});

test('analytics cleans the same-origin referrer after navigating from a query-bearing landing page', async ({
  page,
  baseURL,
  site,
}) => {
  const locale = homeLocale(site);
  const t = site.messages(locale);
  await page.route(`${baseURL}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = (await response.text())
      .replace(/\bdata-ga-id(?:="[^"]*")?/, 'data-ga-id="G-FIXTURE"')
      .replace('data-production="false"', 'data-production="true"');
    await route.fulfill({ response, body: html });
  });
  const optionalLoads: string[] = [];
  await page.route('https://www.googletagmanager.com/**', async (route) => {
    optionalLoads.push(route.request().url());
    await route.fulfill({
      contentType: 'application/javascript',
      body: '/* external analytics boundary fixture: no network */',
    });
  });
  await page.goto('/?email=synthetic@example.invalid#private');
  await page.getByRole('button', { name: t.cookie.customize, exact: true }).click();
  await page.getByRole('checkbox', { name: t.cookie.analytics, exact: true }).check();
  await page.getByRole('button', { name: t.cookie.saveChoices, exact: true }).click();
  await expect.poll(() => optionalLoads.length).toBe(1);
  await page.getByRole('link', { name: t.navigation.contactSales, exact: true }).click();
  await expect(page).toHaveURL(contactPath(site, locale));
  await expect.poll(() => optionalLoads.length).toBe(2);
  const captured = await page.evaluate(() => ({
    referrer: document.referrer,
    config: (window as unknown as { dataLayer: IArguments[] }).dataLayer
      .map((args) => Array.from(args))
      .find((args) => args[0] === 'config')?.[2],
  }));
  expect(captured.referrer).toContain('?email=synthetic@example.invalid');
  expect(captured.config).toMatchObject({
    page_location: `${baseURL}${contactPath(site, locale)}`,
    page_referrer: `${baseURL}/`,
  });
  expect(JSON.stringify(captured.config)).not.toContain('email=');
  expect(JSON.stringify(captured.config)).not.toContain('#private');
  await test.info().attach('analytics-config-inputs', {
    body: JSON.stringify(captured, null, 2),
    contentType: 'application/json',
  });
});

test('storage denial keeps unsent details on the current language page', async ({ page, site }) => {
  test.skip(!secondLocale(site), 'single-language site');
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage) throw new DOMException('Storage disabled', 'SecurityError');
      return setItem.call(this, key, value);
    };
  });
  for (const locale of site.locales) {
    const f = form(site, locale);
    const next = site.locales.find((language) => language !== locale)!;
    await page.goto(contactPath(site, locale));
    await dismissConsent(page, site);
    await page.getByLabel(f.fullName, { exact: true }).fill('Unsaved Buyer');
    await switchLanguage(page, site, next);
    await expect(page).toHaveURL(contactPath(site, locale));
    await expect(page.locator('[data-form-status]')).toContainText(f.localeStorageUnavailable);
    await expect(page.locator('[data-form-status]')).toBeFocused();
    await expect(page.getByLabel(f.fullName, { exact: true })).toHaveValue('Unsaved Buyer');
  }
});

const analyticsFields = [
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmTerm',
  'utmContent',
  'landingPage',
  'capturedAt',
];
const advertisingFields = ['gclid', 'wbraid', 'gbraid'];
const attribution =
  '?utm_source=SourceMarker&utm_medium=MediumMarker&utm_campaign=CampaignMarker&utm_term=TermMarker&utm_content=ContentMarker&gclid=GclidMarker&wbraid=WbraidMarker&gbraid=GbraidMarker';

for (const choice of [
  { name: 'denied', analytics: false, advertising: false },
  { name: 'analytics only', analytics: true, advertising: false },
  { name: 'advertising only', analytics: false, advertising: true },
  { name: 'both permitted', analytics: true, advertising: true },
]) {
  test(`inquiry works with ${choice.name} consent and sends only permitted attribution`, async ({
    page,
    request,
    controlURL,
    site,
  }) => {
    const locale = homeLocale(site);
    const t = site.messages(locale);
    await page.goto(`${contactPath(site, locale)}${attribution}`);
    // The banner explains attribution before anything is stored.
    await expect(page.locator('[data-cookie-banner]')).toContainText(t.cookie.description);
    expect(await page.evaluate(() => sessionStorage.getItem('inquiry_attribution'))).toBeNull();
    await page.getByRole('button', { name: t.cookie.customize, exact: true }).click();
    if (choice.analytics)
      await page.getByRole('checkbox', { name: t.cookie.analytics, exact: true }).check();
    if (choice.advertising)
      await page.getByRole('checkbox', { name: t.cookie.advertising, exact: true }).check();
    await page.getByRole('button', { name: t.cookie.saveChoices, exact: true }).click();
    const expected = [
      ...(choice.analytics ? analyticsFields : []),
      ...(choice.advertising ? advertisingFields : []),
    ].sort();
    const stored = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('inquiry_attribution') || '{}'),
    );
    expect(Object.keys(stored).sort()).toEqual(expected);
    await page.getByLabel(t.inquiry.form.fullName, { exact: true }).fill('Consent Buyer');
    await page.getByLabel(t.inquiry.form.email, { exact: true }).fill('consent@example.test');
    const submitted = page.waitForRequest((request) => request.url().includes('/_actions/inquiry'));
    await page.getByRole('button', { name: t.inquiry.form.submit, exact: true }).click();
    const payload = JSON.parse((await submitted).postData()!);
    expect(
      [...analyticsFields, ...advertisingFields].filter((field) => field in payload).sort(),
    ).toEqual(expected);
    await expect(page.locator('[data-form-status]')).toContainText('INQ-');
    const { calls } = await (await request.get(controlURL)).json();
    const delivered = JSON.stringify(
      calls.filter((call: { url: string }) => /api\.(resend|airtable)\.com/.test(call.url)),
    );
    if (choice.analytics) expect(delivered).toContain('SourceMarker');
    else expect(delivered).not.toContain('SourceMarker');
    if (choice.advertising) expect(delivered).toContain('GclidMarker');
    else expect(delivered).not.toContain('GclidMarker');
  });
}

test('first permitted attribution survives navigation, then withdrawal clears it without blocking inquiry', async ({
  page,
  context,
  site,
}) => {
  const first = homeLocale(site);
  const second = secondLocale(site);
  const t = site.messages(first);
  await page.goto(`${contactPath(site, first)}${attribution}`);
  await page.getByRole('button', { name: t.cookie.acceptAll, exact: true }).click();
  const stored = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('inquiry_attribution')!),
  );
  await page.evaluate(() =>
    history.replaceState(null, '', '?utm_source=LaterMarker&gclid=LaterClick#inquiry'),
  );
  if (second) await switchLanguage(page, site, second);
  await page.reload();
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('inquiry_attribution')!)),
  ).toEqual(stored);

  const sibling = await context.newPage();
  await mockWidget(sibling);
  await sibling.goto('/');
  await sibling.getByRole('button', { name: t.cookie.settings, exact: true }).click();
  await sibling.getByRole('button', { name: t.cookie.rejectAll, exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('inquiry_attribution')))
    .toBeNull();
  await page.reload();
  if (second) await switchLanguage(page, site, first);
  expect(await page.evaluate(() => sessionStorage.getItem('inquiry_attribution'))).toBeNull();
  await page.getByLabel(t.inquiry.form.fullName, { exact: true }).fill('Withdrawn Buyer');
  await page.getByLabel(t.inquiry.form.email, { exact: true }).fill('withdrawn@example.test');
  const submitted = page.waitForRequest((request) => request.url().includes('/_actions/inquiry'));
  await page.getByRole('button', { name: t.inquiry.form.submit, exact: true }).click();
  const payload = JSON.parse((await submitted).postData()!);
  expect([...analyticsFields, ...advertisingFields].filter((field) => field in payload)).toEqual(
    [],
  );
  await expect(page.locator('[data-form-status]')).toContainText('INQ-');
  await sibling.close();
});

test('cross-tab category changes clear only disallowed attribution, including on refresh', async ({
  page,
  context,
  site,
}) => {
  const locale = homeLocale(site);
  await page.goto(`${contactPath(site, locale)}${attribution}`);
  await page
    .getByRole('button', { name: site.messages(locale).cookie.acceptAll, exact: true })
    .click();
  const sibling = await context.newPage();
  await sibling.goto('/');
  // A storage event carries the same persisted shape as the existing consent UI.
  // Exercise each category separately without substituting the application listener.
  for (const consent of [
    { necessary: true, analytics: true, advertising: false },
    { necessary: true, analytics: false, advertising: true },
  ]) {
    await sibling.evaluate(
      (value) =>
        localStorage.setItem(
          'cookie-consent',
          JSON.stringify({
            consent: value,
            updatedAt: new Date().toISOString(),
            version: 3,
          }),
        ),
      consent,
    );
    const expected = (consent.analytics ? analyticsFields : advertisingFields).slice().sort();
    await expect
      .poll(async () =>
        Object.keys(
          await page.evaluate(() =>
            JSON.parse(sessionStorage.getItem('inquiry_attribution') || '{}'),
          ),
        ).sort(),
      )
      .toEqual(expected);
    await page.reload();
    expect(
      Object.keys(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem('inquiry_attribution') || '{}'),
        ),
      ).sort(),
    ).toEqual(expected);
  }
  await sibling.close();
});

test('click-only campaigns keep landing context only with analytics consent', async ({
  page,
  site,
}) => {
  const locale = homeLocale(site);
  const t = site.messages(locale);
  for (const analytics of [true, false]) {
    await page.goto(`${contactPath(site, locale)}?gclid=OnlyClickMarker`);
    await page.getByRole('button', { name: t.cookie.customize, exact: true }).click();
    if (analytics)
      await page.getByRole('checkbox', { name: t.cookie.analytics, exact: true }).check();
    await page.getByRole('checkbox', { name: t.cookie.advertising, exact: true }).check();
    await page.getByRole('button', { name: t.cookie.saveChoices, exact: true }).click();
    const expected = (analytics ? ['gclid', 'landingPage', 'capturedAt'] : ['gclid']).sort();
    const snapshot = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('inquiry_attribution')!),
    );
    expect(Object.keys(snapshot).sort()).toEqual(expected);
    if (analytics) expect(snapshot.landingPage).toBe(contactPath(site, locale));
    await page.getByLabel(t.inquiry.form.fullName, { exact: true }).fill('Click Only Buyer');
    await page.getByLabel(t.inquiry.form.email, { exact: true }).fill('click-only@example.test');
    const submitted = page.waitForRequest((request) => request.url().includes('/_actions/inquiry'));
    await page.getByRole('button', { name: t.inquiry.form.submit, exact: true }).click();
    const payload = JSON.parse((await submitted).postData()!);
    expect(
      [...analyticsFields, ...advertisingFields].filter((field) => field in payload).sort(),
    ).toEqual(expected);
    await expect(page.locator('[data-form-status]')).toContainText('INQ-');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }
});
