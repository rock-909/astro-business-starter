import { test, expect, type Page } from '@playwright/test';

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
// The template ships without a company email; launched sites must configure one (readiness).
// Render the configured contact blocks with a long unbreakable address, as a derived site would.
const longEmail = 'internationalsales@guangzhouhengtaimachinery.com';
async function withLongCompanyEmail(page: Page) {
  await page.route('**/contact', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const link = `<a href="mailto:${longEmail}">${longEmail}</a>`;
    const html = (await response.text())
      .replace(
        /<p>(No business mailbox[^<]*|No se ha configurado un correo[^<]*)<\/p>/,
        `<div class="contact-methods">${link}</div>`,
      )
      .replace('</form>', `</form><p class="fallback">${link}</p>`);
    await route.fulfill({ response, body: html });
  });
}
async function dismissConsent(page: Page) {
  const reject = page.getByRole('button', { name: /^(Reject all|Rechazar todo)$/ });
  if (await reject.isVisible()) await reject.click();
}

test.beforeEach(async ({ page, request }) => {
  await request.post('http://127.0.0.1:4174', { data: { reset: true } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as unknown as { unexpectedErrors: string[] }).unexpectedErrors = errors;
  await mockWidget(page);
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { unexpectedErrors: string[] }).unexpectedErrors).toEqual([]);
});

test('all eight source pages have localized HTML, reciprocal SEO and truthful noindex', async ({
  page,
}) => {
  const definitions = [
    ['/', 'en', 'Inquiry site'],
    ['/contact', 'en', 'Contact'],
    ['/privacy', 'en', 'Privacy policy — to be completed'],
    ['/terms', 'en', 'Terms — to be completed'],
    ['/es', 'es', 'Sitio de consultas'],
    ['/es/contact', 'es', 'Contacto'],
    ['/es/privacy', 'es', 'Privacidad — pendiente de completar'],
    ['/es/terms', 'es', 'Condiciones — pendientes de completar'],
  ];
  for (const [path, locale, heading] of definitions) {
    const response = await page.goto(path!);
    expect(response?.status()).toBe(200);
    expect(response?.request().redirectedFrom()).toBeNull();
    await expect(page.locator('html')).toHaveAttribute('lang', locale!);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading!);
    expect(await page.locator('main').count()).toBe(1);
    const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
    expect(new URL(canonical!).pathname).toBe(path);
    await expect(page.locator('link[hreflang=en]')).toHaveCount(1);
    await expect(page.locator('link[hreflang=es]')).toHaveCount(1);
    await expect(page.locator('link[hreflang=x-default]')).toHaveCount(1);
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex,nofollow');
    const graph = JSON.parse(await page.locator('script[type="application/ld+json"]').innerHTML());
    expect(
      graph['@graph'].some((node: { '@type': string }) => node['@type'] === 'Organization'),
    ).toBe(false);
    expect(graph['@graph'].some((node: { '@type': string }) => node['@type'] === 'WebSite')).toBe(
      true,
    );
  }
});

test('unknown routes give localized 404 recovery rather than false business pages', async ({
  page,
}) => {
  let response = await page.goto('/missing-offering');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  response = await page.goto('/es/missing-offering');
  expect(response?.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Página no encontrada');
  await page.getByRole('link', { name: 'Volver al inicio' }).click();
  await expect(page).toHaveURL(/\/es$/);
});

test('locale switch preserves route, query, hash and unsent buyer fields', async ({ page }) => {
  await page.goto('/contact?utm_source=locale-test#inquiry');
  await dismissConsent(page);
  await page.getByLabel('Full name', { exact: true }).fill('Alex Buyer');
  await page.getByLabel('Email address', { exact: true }).fill('alex+quote@example.test');
  await page.getByLabel(/Message \(optional\)/).fill('Keep this inquiry\nwith its second line.');
  await page.getByRole('link', { name: 'Español', exact: true }).click();
  await expect(page).toHaveURL('/es/contact?utm_source=locale-test#inquiry');
  await expect(page.getByLabel('Nombre completo', { exact: true })).toHaveValue('Alex Buyer');
  await expect(page.getByLabel('Dirección de correo electrónico', { exact: true })).toHaveValue(
    'alex+quote@example.test',
  );
  await expect(page.getByLabel(/Mensaje \(opcional\)/)).toHaveValue(
    'Keep this inquiry\nwith its second line.',
  );
  await page.getByRole('link', { name: 'English', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Alex Buyer');
});

test('theme and granular consent persist, reopen withdraws and cross-tab changes sync', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Analytics', exact: true }).check();
  await page.getByRole('button', { name: 'Save choices', exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cookie-consent')!).consent),
  ).toEqual({ necessary: true, analytics: true, advertising: false });
  await page.getByRole('combobox', { name: 'Theme selector' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('region', { name: 'Cookie preferences' })).toBeHidden();
  const sibling = await context.newPage();
  await sibling.goto('/es');
  await page.getByRole('button', { name: 'Cookie settings' }).click();
  await expect(page.getByRole('region', { name: 'Cookie preferences' })).toBeVisible();
  await expect(sibling.getByRole('region', { name: 'Preferencias de cookies' })).toBeVisible();
  await page.getByRole('button', { name: 'Reject all', exact: true }).click();
  await expect(sibling.getByRole('region', { name: 'Preferencias de cookies' })).toBeHidden();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cookie-consent')!).consent),
  ).toEqual({ necessary: true, analytics: false, advertising: false });
  await page.getByRole('combobox', { name: 'Theme selector' }).selectOption('system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(0);
  await sibling.close();
});

test('EN and ES browser submissions reach the real Action and require fresh verification', async ({
  page,
}) => {
  for (const locale of ['en', 'es']) {
    await page.goto(locale === 'en' ? '/contact' : '/es/contact');
    await dismissConsent(page);
    await page
      .getByLabel(locale === 'en' ? 'Full name' : 'Nombre completo', { exact: true })
      .fill('Browser Buyer');
    await page
      .getByLabel(locale === 'en' ? 'Email address' : 'Dirección de correo electrónico', {
        exact: true,
      })
      .fill('browser+fixture@example.test');
    await page
      .getByLabel(locale === 'en' ? /Message \(optional\)/ : /Mensaje \(opcional\)/)
      .fill('Actual browser → Astro Action → mocked provider boundaries.');
    const request = page.waitForRequest(
      (request) => request.url().includes('/_actions/inquiry') && request.method() === 'POST',
    );
    await page
      .getByRole('button', {
        name: locale === 'en' ? 'Send inquiry' : 'Enviar consulta',
        exact: true,
      })
      .click();
    expect(JSON.parse((await request).postData()!).fullName).toBe('Browser Buyer');
    await expect(page.locator('[data-form-status]')).toContainText('INQ-');
    await expect(
      page.getByLabel(locale === 'en' ? 'Full name' : 'Nombre completo', { exact: true }),
    ).toHaveValue('');
    await expect(
      page.getByRole('button', {
        name: locale === 'en' ? 'Send inquiry' : 'Enviar consulta',
        exact: true,
      }),
    ).toBeDisabled();
    await page.getByRole('button', { name: '[Test] Complete verification', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: locale === 'en' ? 'Send inquiry' : 'Enviar consulta',
        exact: true,
      }),
    ).toBeEnabled();
    await page.evaluate(() =>
      (window as unknown as { __turnstileOptions: Record<string, () => void> }).__turnstileOptions[
        'expired-callback'
      ]!(),
    );
    await expect(
      page.getByRole('button', {
        name: locale === 'en' ? 'Send inquiry' : 'Enviar consulta',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(page.locator('[data-verification-status]')).toContainText(
      locale === 'en' ? 'expired' : 'caducado',
    );
  }
});

test('native validation keeps fields; verification load failure is explained without bypass', async ({
  page,
}) => {
  await page.goto('/contact');
  await dismissConsent(page);
  await page.getByLabel('Email address', { exact: true }).fill('not-an-email');
  await page.getByRole('button', { name: 'Send inquiry', exact: true }).click();
  await expect(page.getByText('Full name is required', { exact: true })).toBeVisible();
  await expect(page.getByText('Please enter a valid email address', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('not-an-email');
  await page.unroute('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) => route.abort(),
  );
  await page.reload();
  await expect(page.locator('[data-verification-status]')).toHaveText(
    'Security check did not load. Reload the page, or email us at the address on this page.',
  );
  await expect(page.getByRole('button', { name: 'Send inquiry', exact: true })).toBeDisabled();
});

test('no-JS content, legal links, and secure fallback remain readable', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: 'http://127.0.0.1:4173',
  });
  const page = await context.newPage();
  await page.goto('/es/contact');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contacto');
  // Playwright's text engine deliberately skips noscript descendants even when
  // scripting is disabled; assert the actual rendered fallback element instead.
  await expect(page.locator('noscript .fallback')).toHaveText(
    'El formulario seguro necesita JavaScript porque la verificación contra bots no puede ejecutarse sin él.',
  );
  await expect(page.locator('noscript .fallback')).toBeVisible();
  await expect(page.getByRole('button', { name: /Enviar consulta/ })).toBeDisabled();
  // Nothing claims the check is broken, and the no-JS notice comes before the fields.
  await expect(page.locator('[data-verification-status]')).toHaveText('');
  expect(
    await page
      .locator('noscript:has(.fallback)')
      .evaluate((notice) =>
        Boolean(
          notice.compareDocumentPosition(document.querySelector('form[data-inquiry-form]')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
  ).toBe(true);
  // Script-only footer controls are not offered when they cannot work.
  await expect(page.getByRole('button', { name: 'Configuración de cookies' })).toBeHidden();
  await expect(page.locator('[data-theme-select]')).toBeHidden();
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Política de privacidad', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Privacidad — pendiente de completar',
  );
  await context.close();
});

test('mobile layout is keyboard usable and has no horizontal overflow', async ({ page }) => {
  // 320px is the WCAG 1.4.10 reflow width; the fixture widget is as wide as real Turnstile.
  for (const path of ['/contact', '/es/contact']) {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(path);
    await dismissConsent(page);
    await expect(page.getByRole('button', { name: '[Test] Complete verification' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/contact');
  await dismissConsent(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveCount(1);
  await expect(page.getByLabel('Full name', { exact: true })).toBeVisible();
  await expect(page.locator('.privacy-notice')).toHaveText(
    'By submitting this form, you agree to our Privacy Policy and Terms of Service.',
  );
  await expect(page.locator('.privacy-notice a')).toHaveText([
    'Privacy Policy',
    'Terms of Service',
  ]);
  await expect(page.locator('[data-submit]')).toHaveText(/^Send inquiry\s*↗$/);
  await page.screenshot({ path: 'test-results/contact-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
});

test('a long company email fits phone widths, keeps the compact widget and keeps form-first Tab order', async ({
  page,
}) => {
  await withLongCompanyEmail(page);
  for (const width of [320, 375]) {
    for (const path of ['/contact', '/es/contact']) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(path);
      await dismissConsent(page);
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
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/contact');
  await dismissConsent(page);
  const fullName = page.getByLabel('Full name', { exact: true });
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

test('long words in headings wrap at 320px instead of widening the page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const [path, level] of [
    ['/es', 1],
    ['/es/contact', 2],
  ] as const) {
    await page.goto(path);
    await dismissConsent(page);
    await page
      .getByRole('heading', { level })
      .first()
      .evaluate((heading) => (heading.textContent = 'Telecomunicaciones industriales'));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      path,
    ).toBe(true);
  }
});

test('security check reads as loading, then stays quiet while the challenge waits', async ({
  page,
}) => {
  for (const [path, loading, unavailable] of [
    ['/contact', 'Loading security check', 'temporarily unavailable'],
    ['/es/contact', 'Cargando la verificación de seguridad', 'no está disponible'],
  ]) {
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
    await page.goto(path!, { waitUntil: 'domcontentloaded' });
    const status = page.locator('[data-verification-status]');
    await expect(status).toContainText(loading!);
    release();
    await expect.poll(() => page.evaluate(() => '__turnstileOptions' in window)).toBe(true);
    await expect(status).toHaveText('');
    await expect(page.locator('[data-submit]')).toBeDisabled();
    await page.evaluate(() =>
      (window as unknown as { __turnstileOptions: Record<string, () => void> }).__turnstileOptions[
        'error-callback'
      ]!(),
    );
    await expect(status).toContainText(unavailable!);
  }
});

test('on a phone, every Tab stop up to the footer stays clear of the open cookie card', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, title] of [
    ['/contact', 'Cookie preferences'],
    ['/es/contact', 'Preferencias de cookies'],
    ['/privacy', 'Cookie preferences'],
  ] as const) {
    await page.goto(path);
    const banner = page.getByRole('region', { name: title });
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
}) => {
  for (const [width, height] of [
    [320, 256],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [path, customize, privacy] of [
      ['/contact', 'Customize', 'Privacy policy'],
      ['/es/contact', 'Personalizar', 'Política de privacidad'],
    ] as const) {
      await page.goto(path);
      const banner = page.locator('[data-cookie-banner]');
      await banner.getByRole('button', { name: customize, exact: true }).click();
      const box = (await banner.boundingBox())!;
      expect(box.y, `${path} at ${width}x${height} card top`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      // The privacy link a visitor is consenting under can be reached and seen.
      const link = banner.getByRole('link', { name: privacy, exact: true });
      await link.focus();
      const linkBox = (await link.boundingBox())!;
      expect(linkBox.y, `${path} at ${width}x${height} link`).toBeGreaterThanOrEqual(0);
      expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(height);
    }
  }
});

test('Customize comes last and Tab moves straight into the options it reveals', async ({
  page,
}) => {
  for (const [path, customize, labels] of [
    ['/', 'Customize', ['Analytics', 'Advertising', 'Save choices']],
    ['/es', 'Personalizar', ['Análisis', 'Publicidad', 'Guardar elecciones']],
  ] as const) {
    await page.goto(path);
    const button = page.getByRole('button', { name: customize, exact: true });
    const collapsed = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    // The expanded state is visible, not only announced.
    expect(await button.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      collapsed,
    );
    for (const label of labels) {
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
}) => {
  for (const [path, settings, reject, customize, save] of [
    ['/privacy', 'Cookie settings', 'Reject all', 'Customize', 'Save choices'],
    [
      '/es/privacy',
      'Configuración de cookies',
      'Rechazar todo',
      'Personalizar',
      'Guardar elecciones',
    ],
  ] as const) {
    await page.goto(path);
    await dismissConsent(page);
    const trigger = page.getByRole('button', { name: settings, exact: true });
    // Once with a quick choice, once through the expanded options.
    for (const finalChoice of [reject, save]) {
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: customize, exact: true })).toBeFocused();
      if (finalChoice === save) {
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
}) => {
  await page.goto('/privacy');
  await dismissConsent(page);
  const trigger = page.getByRole('button', { name: 'Cookie settings', exact: true });
  // Safari does not focus a clicked button, so the click arrives while focus is still on body.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await trigger.dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeFocused();
  for (let step = 0; step < 2; step++) await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Reject all', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-cookie-banner]')).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('language links have 24px phone targets and spoken language names', async ({ page }) => {
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/es/contact');
    for (const [name, text] of [
      ['English', 'EN'],
      ['Español', 'ES'],
    ]) {
      const link = page.getByRole('link', { name, exact: true });
      await expect(link).toHaveText(text);
      const box = (await link.boundingBox())!;
      expect(box.width, `${name} at ${width}px`).toBeGreaterThanOrEqual(24);
      expect(box.height, `${name} at ${width}px`).toBeGreaterThanOrEqual(24);
    }
  }
});

test('the theme select shows the current theme and the template mark appears without a logo', async ({
  page,
}) => {
  await page.goto('/');
  await dismissConsent(page);
  const select = page.getByRole('combobox', { name: 'Theme selector' });
  await expect(select.locator('option')).toHaveText(['System', 'Light', 'Dark']);
  await select.selectOption('dark');
  await expect(select.locator('option:checked')).toHaveText('Dark');
  await page.goto('/es');
  const selectEs = page.getByRole('combobox', { name: 'Selector de tema' });
  await expect(selectEs.locator('option')).toHaveText(['Sistema', 'Claro', 'Oscuro']);
  await expect(selectEs.locator('option:checked')).toHaveText('Oscuro');
  // The template ships without a logo, so its own mark stands in next to the site name.
  await expect(page.locator('.brand .brand-mark')).toBeVisible();
  await expect(page.locator('.site-header .brand img')).toHaveCount(0);
});

test('legal pages show the last-updated date in the page language', async ({ page }) => {
  for (const [path, pattern] of [
    ['/privacy', /^[A-Z][a-z]+ \d{1,2}, \d{4}$/],
    ['/terms', /^[A-Z][a-z]+ \d{1,2}, \d{4}$/],
    ['/es/privacy', /^\d{1,2} de [a-z]+ de \d{4}$/],
    ['/es/terms', /^\d{1,2} de [a-z]+ de \d{4}$/],
  ] as const) {
    await page.goto(path);
    const time = page.locator('.legal-note time');
    await expect(time).toHaveText(pattern);
    await expect(time).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('keyboard and assistive tech never reach the honeypot field', async ({ page }) => {
  await page.goto('/contact');
  await dismissConsent(page);
  const form = page.locator('form[data-inquiry-form]');
  await expect(form.getByRole('textbox', { name: 'Website' })).toHaveCount(0);
  const honeypot = page.locator('#website');
  await expect(honeypot).toHaveAttribute('tabindex', '-1');
  await expect(honeypot).toHaveAttribute('autocomplete', 'off');
  await expect(honeypot.locator('..')).toHaveAttribute('aria-hidden', 'true');

  await page.getByLabel('Full name', { exact: true }).focus();
  const privacy = form.getByRole('link', { name: 'Privacy Policy' });
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

test('session draft survives refresh and a legal-page round trip', async ({ page }) => {
  await page.goto('/contact');
  await dismissConsent(page);
  await page.getByLabel('Full name', { exact: true }).fill('Persistent Buyer');
  await page.getByLabel('Email address', { exact: true }).fill('draft@example.test');
  await page.getByLabel(/Message \(optional\)/).fill('Retain this unsent draft.');
  await page.reload();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Persistent Buyer');
  await page.getByRole('link', { name: 'Privacy Policy', exact: true }).first().click();
  await page.getByRole('link', { name: 'Start an inquiry' }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('draft@example.test');
  await expect(page.getByLabel(/Message \(optional\)/)).toHaveValue('Retain this unsent draft.');
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
  const longestMessage = 'M'.repeat(2000);
  await page.getByLabel(/Message \(optional\)/).fill(longestMessage);
  await page.reload();
  await page.getByRole('link', { name: 'Español', exact: true }).click();
  await expect(page.getByLabel(/Mensaje \(opcional\)/)).toHaveValue(longestMessage);
});

test('pending submission locks buyer edits and duplicate Enter, then clears only confirmed data', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:4174', { data: { delay: 1500 } });
  await page.goto('/contact');
  await dismissConsent(page);
  await page.getByLabel('Full name', { exact: true }).fill('One Pending Buyer');
  await page.getByLabel('Email address', { exact: true }).fill('pending@example.test');
  const submissions: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/_actions/inquiry')) submissions.push(request.url());
  });
  await page.getByRole('button', { name: 'Send inquiry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
  // Screen readers hear the wait, and focus is kept on the announcement instead of the page body.
  await expect(page.locator('[data-form-status]')).toHaveText('Sending…');
  await expect(page.locator('[data-form-status]')).toBeFocused();
  await expect(page.getByLabel('Full name', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Email address', { exact: true })).toBeDisabled();
  await expect(page.getByLabel(/Message \(optional\)/)).toBeDisabled();
  await page.locator('[data-inquiry-form]').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.getByRole('link', { name: 'Español', exact: true }).click();
  await expect(page).toHaveURL('/contact');
  await expect(page.locator('[data-form-status]')).toContainText('Wait for the inquiry result');
  await expect(page.locator('[data-form-status]')).toContainText('INQ-');
  expect(submissions).toHaveLength(1);
  const { calls } = await (await request.get('http://127.0.0.1:4174')).json();
  expect(calls.filter((call: { url: string }) => call.url.includes('api.resend.com'))).toHaveLength(
    1,
  );
  expect(
    calls.filter((call: { url: string }) => call.url.includes('api.airtable.com')),
  ).toHaveLength(1);
  await expect(page.getByLabel('Full name', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => sessionStorage.getItem('inquiry-draft'))).toBeNull();
});

test('unconfirmed delivery keeps draft and retries only after explicit buyer action with fresh token', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:4174', { data: { email: 'reject', airtable: 'reject' } });
  await page.goto('/contact');
  await dismissConsent(page);
  await page.getByLabel('Full name', { exact: true }).fill('Retry Buyer');
  await page.getByLabel('Email address', { exact: true }).fill('retry@example.test');
  await page.getByRole('button', { name: 'Send inquiry', exact: true }).click();
  await expect(page.locator('[data-form-status]')).toContainText('may have been received');
  await expect(page.locator('[data-form-status]')).toContainText(
    'email us at the address on this page',
  );
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Retry Buyer');
  await expect(page.getByRole('button', { name: 'Send inquiry', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('inquiry-draft')!).fullName),
  ).toBe('Retry Buyer');
  await request.post('http://127.0.0.1:4174', { data: { email: 'accept', airtable: 'reject' } });
  await page.getByRole('button', { name: '[Test] Complete verification', exact: true }).click();
  await page.getByRole('button', { name: 'Send inquiry', exact: true }).click();
  await expect(page.locator('[data-form-status]')).toContainText('INQ-');
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('');
});

test('server canonical validation maps an email rejection to localized field and focus', async ({
  page,
}) => {
  await page.goto('/es/contact');
  await dismissConsent(page);
  await page.getByLabel('Nombre completo', { exact: true }).fill('Valid Buyer');
  await page
    .getByLabel('Dirección de correo electrónico', { exact: true })
    .fill('+buyer@example.test');
  await page.getByRole('button', { name: 'Enviar consulta', exact: true }).click();
  await expect(page.getByLabel('Dirección de correo electrónico', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(
    page.getByText('Introduce una dirección de correo válida', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Dirección de correo electrónico', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Dirección de correo electrónico', { exact: true })).toHaveValue(
    '+buyer@example.test',
  );
});

test('rate-limit cooldown blocks repeat submit until elapsed and still needs fresh token', async ({
  page,
  request,
}) => {
  await page.clock.install();
  await request.post('http://127.0.0.1:4174', { data: { rateCount: 11, rateTtl: 60000 } });
  await page.goto('/contact');
  await dismissConsent(page);
  await page.getByLabel('Full name', { exact: true }).fill('Rate Buyer');
  await page.getByLabel('Email address', { exact: true }).fill('rate@example.test');
  await page.getByRole('button', { name: 'Send inquiry', exact: true }).click();
  await expect(page.locator('[data-form-status]')).toContainText(
    'Too many attempts. Wait about a minute',
  );
  await page.getByRole('button', { name: '[Test] Complete verification', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send inquiry', exact: true })).toBeDisabled();
  await page.locator('[data-inquiry-form]').dispatchEvent('submit');
  let state = await (await request.get('http://127.0.0.1:4174')).json();
  expect(state.calls).toHaveLength(1);
  await page.clock.fastForward(60001);
  await expect(page.getByRole('button', { name: 'Send inquiry', exact: true })).toBeEnabled();
  await request.post('http://127.0.0.1:4174', { data: { rateCount: 1 } });
  await page.getByRole('button', { name: 'Send inquiry', exact: true }).click();
  await expect(page.locator('[data-form-status]')).toContainText('INQ-');
});

test('losing the real Action response after provider acceptance retains data and does not retry', async ({
  page,
  request,
}) => {
  await page.goto('/contact');
  await dismissConsent(page);
  await page.getByLabel('Full name', { exact: true }).fill('Response Lost Buyer');
  await page.getByLabel('Email address', { exact: true }).fill('lost@example.test');
  let responsesDropped = 0;
  await page.route('**/_actions/inquiry', async (route) => {
    // Execute the actual Action fully, then simulate network loss. Do not forge
    // an Action success response or substitute the handler/schema.
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    responsesDropped++;
    await route.abort('connectionfailed');
  });
  await page.getByRole('button', { name: 'Send inquiry', exact: true }).click();
  await expect(page.locator('[data-form-status]')).toContainText('may have been received');
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Response Lost Buyer');
  await expect(page.getByRole('button', { name: 'Send inquiry', exact: true })).toBeDisabled();
  const { calls } = await (await request.get('http://127.0.0.1:4174')).json();
  expect(
    calls.filter((call: { url: string }) => /api\.(resend|airtable)\.com/.test(call.url)),
  ).toHaveLength(2);
  expect(responsesDropped).toBe(1);
});

test('configured analytics uses real consent code: no optional tag before consent, clean URL, withdrawal', async ({
  page,
}) => {
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
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Analytics', exact: true }).check();
  await page.getByRole('button', { name: 'Save choices', exact: true }).click();
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
  await page.getByRole('button', { name: 'Cookie settings', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as Record<string, unknown>)['ga-disable-G-FIXTURE'],
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('_ga=');
});

test('locale switch uses the current hash and query after an in-page navigation', async ({
  page,
}) => {
  await page.goto('/contact');
  await dismissConsent(page);
  await page.getByLabel('Full name', { exact: true }).fill('Current Location Buyer');
  await page.getByLabel('Email address', { exact: true }).fill('current@example.test');
  await page.locator('.prose a[href$="#inquiry"]').click();
  await expect(page).toHaveURL('/contact#inquiry');
  await page.evaluate(() => history.replaceState(null, '', '?source=current#inquiry'));
  await page.getByRole('link', { name: 'Español', exact: true }).click();
  await expect(page).toHaveURL('/es/contact?source=current#inquiry');
  await expect(page.getByLabel('Nombre completo', { exact: true })).toHaveValue(
    'Current Location Buyer',
  );
  await expect(page.getByLabel('Dirección de correo electrónico', { exact: true })).toHaveValue(
    'current@example.test',
  );
  await page.getByRole('link', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL('/contact?source=current#inquiry');
});

test('active inquiry field boundaries have at least 3:1 contrast in both themes', async ({
  page,
}) => {
  await page.goto('/contact');
  await dismissConsent(page);
  const measurements = [];
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Theme selector' }).selectOption(theme);
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
}) => {
  await page.route('http://127.0.0.1:4173/**', async (route) => {
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
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Analytics', exact: true }).check();
  await page.getByRole('button', { name: 'Save choices', exact: true }).click();
  await expect.poll(() => optionalLoads.length).toBe(1);
  await page.getByRole('link', { name: 'Start an inquiry', exact: true }).click();
  await expect(page).toHaveURL('/contact');
  await expect.poll(() => optionalLoads.length).toBe(2);
  const captured = await page.evaluate(() => ({
    referrer: document.referrer,
    config: (window as unknown as { dataLayer: IArguments[] }).dataLayer
      .map((args) => Array.from(args))
      .find((args) => args[0] === 'config')?.[2],
  }));
  expect(captured.referrer).toContain('?email=synthetic@example.invalid');
  expect(captured.config).toMatchObject({
    page_location: 'http://127.0.0.1:4173/contact',
    page_referrer: 'http://127.0.0.1:4173/',
  });
  expect(JSON.stringify(captured.config)).not.toContain('email=');
  expect(JSON.stringify(captured.config)).not.toContain('#private');
  await test.info().attach('analytics-config-inputs', {
    body: JSON.stringify(captured, null, 2),
    contentType: 'application/json',
  });
});

test('storage denial keeps unsent details on the current language page', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage) throw new DOMException('Storage disabled', 'SecurityError');
      return setItem.call(this, key, value);
    };
  });
  for (const [path, label, nextLanguage, message] of [
    ['/contact', 'Full name', 'Español', 'Your browser cannot preserve this draft'],
    ['/es/contact', 'Nombre completo', 'English', 'El navegador no permite conservar el borrador'],
  ]) {
    await page.goto(path!);
    await dismissConsent(page);
    await page.getByLabel(label!, { exact: true }).fill('Unsaved Buyer');
    await page.getByRole('link', { name: nextLanguage!, exact: true }).click();
    await expect(page).toHaveURL(path!);
    await expect(page.locator('[data-form-status]')).toContainText(message!);
    await expect(page.locator('[data-form-status]')).toBeFocused();
    await expect(page.getByLabel(label!, { exact: true })).toHaveValue('Unsaved Buyer');
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
const attributedContact =
  '/contact?utm_source=SourceMarker&utm_medium=MediumMarker&utm_campaign=CampaignMarker&utm_term=TermMarker&utm_content=ContentMarker&gclid=GclidMarker&wbraid=WbraidMarker&gbraid=GbraidMarker';

for (const choice of [
  { name: 'denied', analytics: false, advertising: false },
  { name: 'analytics only', analytics: true, advertising: false },
  { name: 'advertising only', analytics: false, advertising: true },
  { name: 'both permitted', analytics: true, advertising: true },
]) {
  test(`inquiry works with ${choice.name} consent and sends only permitted attribution`, async ({
    page,
    request,
  }) => {
    await page.goto(attributedContact);
    await expect(page.locator('[data-cookie-banner]')).toContainText(
      'campaign/source details with your inquiry',
    );
    await expect(page.locator('[data-cookie-banner]')).toContainText('saves ad click IDs');
    await expect(page.locator('[data-cookie-banner]')).toContainText(
      'send an inquiry without either choice',
    );
    expect(await page.evaluate(() => sessionStorage.getItem('inquiry_attribution'))).toBeNull();
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    if (choice.analytics)
      await page.getByRole('checkbox', { name: 'Analytics', exact: true }).check();
    if (choice.advertising)
      await page.getByRole('checkbox', { name: 'Advertising', exact: true }).check();
    await page.getByRole('button', { name: 'Save choices', exact: true }).click();
    const expected = [
      ...(choice.analytics ? analyticsFields : []),
      ...(choice.advertising ? advertisingFields : []),
    ].sort();
    const stored = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('inquiry_attribution') || '{}'),
    );
    expect(Object.keys(stored).sort()).toEqual(expected);
    await page.getByLabel('Full name', { exact: true }).fill('Consent Buyer');
    await page.getByLabel('Email address', { exact: true }).fill('consent@example.test');
    const submitted = page.waitForRequest((request) => request.url().includes('/_actions/inquiry'));
    await page.getByRole('button', { name: 'Send inquiry', exact: true }).click();
    const payload = JSON.parse((await submitted).postData()!);
    expect(
      [...analyticsFields, ...advertisingFields].filter((field) => field in payload).sort(),
    ).toEqual(expected);
    await expect(page.locator('[data-form-status]')).toContainText('INQ-');
    const { calls } = await (await request.get('http://127.0.0.1:4174')).json();
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
}) => {
  await page.goto(attributedContact);
  await page.getByRole('button', { name: 'Allow all', exact: true }).click();
  const first = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('inquiry_attribution')!),
  );
  await page.evaluate(() =>
    history.replaceState(null, '', '?utm_source=LaterMarker&gclid=LaterClick#inquiry'),
  );
  await page.getByRole('link', { name: 'Español', exact: true }).click();
  await page.reload();
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('inquiry_attribution')!)),
  ).toEqual(first);

  const sibling = await context.newPage();
  await mockWidget(sibling);
  await sibling.goto('/');
  await sibling.getByRole('button', { name: 'Cookie settings', exact: true }).click();
  await sibling.getByRole('button', { name: 'Reject all', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('inquiry_attribution')))
    .toBeNull();
  await page.reload();
  await page.getByRole('link', { name: 'English', exact: true }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('inquiry_attribution'))).toBeNull();
  await page.getByLabel('Full name', { exact: true }).fill('Withdrawn Buyer');
  await page.getByLabel('Email address', { exact: true }).fill('withdrawn@example.test');
  const submitted = page.waitForRequest((request) => request.url().includes('/_actions/inquiry'));
  await page.getByRole('button', { name: 'Send inquiry', exact: true }).click();
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
}) => {
  await page.goto(attributedContact);
  await page.getByRole('button', { name: 'Allow all', exact: true }).click();
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

test('click-only campaigns keep landing context only with analytics consent', async ({ page }) => {
  for (const analytics of [true, false]) {
    await page.goto('/contact?gclid=OnlyClickMarker');
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    if (analytics) await page.getByRole('checkbox', { name: 'Analytics', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Advertising', exact: true }).check();
    await page.getByRole('button', { name: 'Save choices', exact: true }).click();
    const expected = (analytics ? ['gclid', 'landingPage', 'capturedAt'] : ['gclid']).sort();
    const snapshot = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('inquiry_attribution')!),
    );
    expect(Object.keys(snapshot).sort()).toEqual(expected);
    if (analytics) expect(snapshot.landingPage).toBe('/contact');
    await page.getByLabel('Full name', { exact: true }).fill('Click Only Buyer');
    await page.getByLabel('Email address', { exact: true }).fill('click-only@example.test');
    const submitted = page.waitForRequest((request) => request.url().includes('/_actions/inquiry'));
    await page.getByRole('button', { name: 'Send inquiry', exact: true }).click();
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
