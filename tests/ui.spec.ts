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
      const link = `<a href="mailto:${longEmail}">${longEmail}</a>`;
      const methods = `<div class="contact-methods">${link}</div>`;
      let html = await response.text();
      const unconfigured = site.locales
        .map(
          (locale) =>
            `<p>${escapeHtml(site.messages(locale).contact.panel.unconfiguredMailbox)}</p>`,
        )
        .find((paragraph) => html.includes(paragraph));
      const configured = /<div class="contact-methods">[\s\S]*?<\/div>/;
      if (configured.test(html)) {
        html = html.replace(configured, methods);
        if (unconfigured) html = html.replace(unconfigured, '');
      } else if (unconfigured) html = html.replace(unconfigured, methods);
      else html = html.replace('</aside>', `${methods}</aside>`);
      if (!/class="fallback"[^>]*>[^<]*<a href="mailto:/.test(html))
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
// The language switcher shows each language's registered label and speaks its own name.
const languageLink = (page: Page, site: Site, locale: Locale) =>
  page.getByRole('link', { name: site.localeTable[locale].name, exact: true });
// Brand names the footer gives each configured social network.
const socialNames = { linkedin: 'LinkedIn', twitter: 'X' };
const homeLocale = (site: Site) => site.locales[0];
const secondLocale = (site: Site) => site.locales[1];
const contactPath = (site: Site, locale: Locale) => site.pathFor(locale, 'contact');

test.beforeEach(async ({ page, request, controlURL }) => {
  await request.post(controlURL, { data: { reset: true } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as unknown as { unexpectedErrors: string[] }).unexpectedErrors = errors;
  await mockWidget(page);
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
    if (contact.email)
      // Scoped to the contact aside: the form's fallback line repeats the mailbox and
      // would otherwise hide a missing contact method.
      await expect(
        main.locator('.contact-aside').getByRole('link', { name: contact.email, exact: true }),
      ).toHaveAttribute('href', `mailto:${contact.email}`);
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
      await expect(logo).toHaveCount(0);
      await expect(page.getByRole('banner').locator('.brand .brand-mark')).toBeVisible();
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
    await expect(footer.locator('a[href^="http"]')).toHaveCount(
      Object.values(social).filter(Boolean).length,
    );
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
    await page.getByRole('link', { name: notFound.goHome }).click();
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
  await languageLink(page, site, second!).click();
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
  await languageLink(page, site, first).click();
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
  const theme = page.getByRole('combobox', { name: t.accessibility.themeSelector });
  await theme.selectOption('dark');
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
  await theme.selectOption('system');
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
  await expect(page.locator('[data-theme-select]')).toBeHidden();
  // Without the form, a configured mailbox is the way to reach the business.
  const email = site.site.contact.email;
  if (email)
    await expect(
      page.getByRole('region', { name: f.contactAriaLabel }).getByRole('link', { name: email }),
    ).toHaveAttribute('href', `mailto:${email}`);
  else await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
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

test('a long company email fits phone widths, keeps the compact widget and keeps form-first Tab order', async ({
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
      expect(
        await page.evaluate(
          () => (window as unknown as { __turnstileOptions: { size?: string } }).__turnstileOptions,
        ),
      ).toMatchObject({ size: 'compact' });
    }
  }
  // Phone: the form is shown first, so keyboard focus must reach it before the contact links.
  const f = form(site, homeLocale(site));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(contactPath(site, homeLocale(site)));
  await dismissConsent(page, site);
  const fullName = page.getByLabel(f.fullName, { exact: true });
  const asideEmail = page.locator('.contact-methods a');
  expect((await fullName.boundingBox())!.y).toBeLessThan((await asideEmail.boundingBox())!.y);
  const order: string[] = [];
  for (let presses = 0; presses < 40 && order.length < 2; presses++) {
    await page.keyboard.press('Tab');
    if (await fullName.evaluate((field) => field === document.activeElement)) order.push('form');
    if (await asideEmail.evaluate((link) => link === document.activeElement)) order.push('aside');
  }
  expect(order).toEqual(['form', 'aside']);
  // Wide screens keep the direct contact column on the left of the form.
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await asideEmail.boundingBox())!.x).toBeLessThan((await fullName.boundingBox())!.x);
});

test('header marks the current page and language alike; links and buttons react to hover in both themes', async ({
  page,
  site,
}) => {
  const locale = homeLocale(site);
  const t = site.messages(locale);
  const decoration = (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.textDecorationLine} ${style.textDecorationThickness}`;
    });
  await page.goto(site.pathFor(locale, 'home'));
  await dismissConsent(page, site);
  // Current items: foreground colour and a 2px underline; the others stay plain until hover.
  const multilingual = site.locales.length > 1;
  for (const selector of [
    `.main-nav a[href="${site.pathFor(locale, 'home')}"]`,
    ...(multilingual ? [`.language-nav a[lang="${locale}"]`] : []),
  ])
    expect(await decoration(selector), selector).toBe('underline 2px');
  for (const selector of [
    `.main-nav a[href="${contactPath(site, locale)}"]`,
    ...site.locales
      .filter((language) => language !== locale)
      .map((language) => `.language-nav a[lang="${language}"]`),
    'a.brand',
  ]) {
    expect(await decoration(selector), selector).toMatch(/^none /);
    await page.locator(selector).hover();
    expect(await decoration(selector), selector).toMatch(/^underline /);
  }
  await expect(page.locator('.main-nav')).not.toContainText('↗');

  const contrast = (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
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
    await page.getByRole('combobox', { name: t.accessibility.themeSelector }).selectOption(theme);
    for (const name of [t.errors.notFound.goHome, t.footer.sections.navigation.contact]) {
      const button = page.locator('main').getByRole('link', { name, exact: true });
      await page.mouse.move(0, 0);
      const resting = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
      await button.hover();
      const hovered = await contrast(`.not-found-actions a:hover`);
      expect(hovered.background, `${theme} ${name}`).not.toBe(resting);
      expect(hovered.ratio, `${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('contact aside has its own line instead of repeating the message hint', async ({
  page,
  site,
}) => {
  const { contact } = site.site;
  const methods = Boolean(contact.email || contact.phone || contact.whatsapp);
  for (const locale of site.locales) {
    const hint = form(site, locale).messageHint;
    await page.goto(contactPath(site, locale));
    await expect(page.locator('#message-hint')).toContainText(hint);
    const aside = page.locator('.contact-aside');
    await expect(aside).not.toContainText(hint);
    // The intro leads into configured contact methods and is absent without them.
    const intro = aside.getByText(site.messages(locale).contact.panel.intro, { exact: true });
    await expect(intro).toHaveCount(methods ? 1 : 0);
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
      ['contact', 2],
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
      reachedFooterEnd = stop.name.startsWith('SELECT');
      if (!stop.clear) stops.push(stop.name);
    }
    expect(reachedFooterEnd, `${path} Tab reached the footer theme select`).toBe(true);
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

test('Customize comes last and Tab moves straight into the options it reveals', async ({
  page,
  site,
}) => {
  for (const locale of site.locales) {
    const { cookie } = site.messages(locale);
    await page.goto(site.pathFor(locale, 'home'));
    const button = page.getByRole('button', { name: cookie.customize, exact: true });
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

test('language links have 24px phone targets and spoken language names; one language shows none', async ({
  page,
  site,
}) => {
  if (site.locales.length === 1) {
    // Nothing to switch to: no lone language link and no empty language navigation.
    await page.goto(site.pathFor(homeLocale(site), 'home'));
    await expect(
      page.getByRole('navigation', { name: site.messages(homeLocale(site)).navigation.language }),
    ).toHaveCount(0);
    await expect(page.locator('[data-locale-link]')).toHaveCount(0);
    return;
  }
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(contactPath(site, secondLocale(site) ?? homeLocale(site)));
    for (const locale of site.locales) {
      const link = languageLink(page, site, locale);
      await expect(link).toHaveText(site.localeTable[locale].label);
      const box = (await link.boundingBox())!;
      expect(box.width, `${locale} at ${width}px`).toBeGreaterThanOrEqual(24);
      expect(box.height, `${locale} at ${width}px`).toBeGreaterThanOrEqual(24);
    }
  }
});

test('every registered page is linked from its navigation, and content pages use the plain layout', async ({
  page,
  site,
}) => {
  for (const locale of site.locales) {
    const t = site.messages(locale);
    await page.goto(site.pathFor(locale, 'home'));
    const main = page.getByRole('navigation', { name: t.accessibility.mainNavigation });
    const footer = page.getByRole('contentinfo');
    for (const entry of site.pages) {
      const { key } = entry;
      const href = site.pathFor(locale, key);
      const nav = 'nav' in entry ? entry.nav : undefined;
      const where = `${locale} ${key} ${nav ?? 'no nav'}`;
      await expect(main.locator(`a[href="${href}"]`), where).toHaveCount(nav === 'main' ? 1 : 0);
      await expect(footer.locator(`a[href="${href}"]`), where).toHaveCount(nav ? 1 : 0);
    }
  }
  // Owner pages that are not legal text: no table of contents, no last-updated line.
  const contentPages = site.pages.filter(({ kind }) => (kind as string) === 'content');
  for (const locale of site.locales)
    for (const { key } of contentPages) {
      const t = site.messages(locale);
      const content = site.pageContent(locale, key as Exclude<typeof key, 'home'>);
      await page.goto(site.pathFor(locale, key));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(content.metadata.title);
      await expect(page.getByRole('navigation', { name: t.legal.tableOfContents })).toHaveCount(0);
      await expect(page.getByRole('main')).not.toContainText(t.legal.lastUpdated);
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
      const probe = document.createElement('span');
      document.body.append(probe);
      const luminance = (color: string) => {
        probe.style.color = color;
        const channels = getComputedStyle(probe)
          .color.match(/[\d.]+/g)!
          .slice(0, 3)
          .map((value) => {
            const channel = Number(value) / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const ratio = (a: string, b: string) => {
        const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (light! + 0.05) / (dark! + 0.05);
      };
      const pairs = [
        ['--on-primary', '--primary'],
        ['--foreground', '--background'],
        ['--muted', '--surface'],
      ];
      const result = Object.entries(themes).flatMap(([name, tokens]) =>
        pairs.map(([text, background]) => ({
          pair: `${name} ${text} on ${background}`,
          ratio: ratio(tokens[text!]!, tokens[background!]!),
        })),
      );
      probe.remove();
      return result;
    },
    { light: themes['light (system)']!, dark: themes['dark (system)']! },
  );
  for (const { pair, ratio } of ratios) expect(ratio, pair).toBeGreaterThanOrEqual(4.5);
  await test.info().attach('theme-token-contrast', {
    body: JSON.stringify(ratios, null, 2),
    contentType: 'application/json',
  });
});

test('the theme select shows the current theme and the header brand follows the logo configuration', async ({
  page,
  site,
}) => {
  for (const [index, locale] of site.locales.entries()) {
    const t = site.messages(locale);
    await page.goto(site.pathFor(locale, 'home'));
    await dismissConsent(page, site);
    const select = page.getByRole('combobox', { name: t.accessibility.themeSelector });
    await expect(select.locator('option')).toHaveText([
      t.theme.system,
      t.theme.light,
      t.theme.dark,
    ]);
    // The first language picks the theme; later ones show the choice it persisted.
    if (index === 0) await select.selectOption('dark');
    await expect(select.locator('option:checked')).toHaveText(t.theme.dark);
  }
  const brand = page.locator('.site-header .brand');
  if (site.site.brandAssets.logo?.status === 'ready') {
    // A configured logo replaces the template mark rather than sitting beside it.
    await expect(brand.locator('img')).toBeVisible();
    await expect(brand.locator('.brand-mark')).toHaveCount(0);
  } else {
    // Without a logo the template's own mark stands in next to the site name.
    await expect(brand.locator('.brand-mark')).toBeVisible();
    await expect(brand.locator('img')).toHaveCount(0);
    await expect(brand).toHaveText(site.site.name);
  }
});

test('legal pages show the last-updated date in the page language', async ({ page, site }) => {
  // Long dates as each language writes them, independent of the formatter the page uses.
  const longDate: Record<string, RegExp> = {
    en: /^[A-Z][a-z]+ \d{1,2}, \d{4}$/,
    es: /^\d{1,2} de [a-z]+ de \d{4}$/,
  };
  for (const locale of site.locales)
    for (const key of ['privacy', 'terms'] as const) {
      await page.goto(site.pathFor(locale, key));
      const time = page.locator('.legal-note time');
      if (longDate[locale]) await expect(time).toHaveText(longDate[locale]);
      await expect(time).toHaveAttribute(
        'datetime',
        site.pageContent(locale, key).metadata.updatedAt,
      );
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
  await languageLink(page, site, second).click();
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
  await expect(page.getByLabel(f.fullName, { exact: true })).toBeDisabled();
  await expect(page.getByLabel(f.email, { exact: true })).toBeDisabled();
  await expect(page.getByLabel(messageLabel(site, locale), { exact: true })).toBeDisabled();
  await page.locator('[data-inquiry-form]').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  const second = secondLocale(site);
  if (second) {
    await languageLink(page, site, second).click();
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
  await languageLink(page, site, second!).click();
  await expect(page).toHaveURL(`${contactPath(site, second!)}?source=current#inquiry`);
  await expect(page.getByLabel(form(site, second!).fullName, { exact: true })).toHaveValue(
    'Current Location Buyer',
  );
  await expect(page.getByLabel(form(site, second!).email, { exact: true })).toHaveValue(
    'current@example.test',
  );
  await languageLink(page, site, first).click();
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
    await page
      .getByRole('combobox', { name: site.messages(locale).accessibility.themeSelector })
      .selectOption(theme);
    for (const name of ['fullName', 'email', 'message']) {
      const field = page.locator(`[name="${name}"]`);
      await expect(field).toBeEditable();
      await field.fill(name === 'email' ? 'contrast@example.test' : 'Editable');
      await field.clear();
      const colors = await field.evaluate((element) => {
        const luminance = (color: string) => {
          const channels = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
        };
        const style = getComputedStyle(element);
        const card = getComputedStyle(element.closest('.inquiry-card')!);
        const border = luminance(style.borderColor);
        const contrast = (background: string) => {
          const adjacent = luminance(background);
          return (Math.max(border, adjacent) + 0.05) / (Math.min(border, adjacent) + 0.05);
        };
        return {
          border: style.borderColor,
          field: style.backgroundColor,
          card: card.backgroundColor,
          fieldRatio: contrast(style.backgroundColor),
          cardRatio: contrast(card.backgroundColor),
        };
      });
      measurements.push({ theme, name, ...colors });
      expect(colors.fieldRatio).toBeGreaterThanOrEqual(3);
      expect(colors.cardRatio).toBeGreaterThanOrEqual(3);
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
    await languageLink(page, site, next).click();
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
  if (second) await languageLink(page, site, second).click();
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
  if (second) await languageLink(page, site, first).click();
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
