import { test, expect, type Page } from '@playwright/test';

const widgetScript = `window.turnstile={render(el,options){window.__turnstileOptions=options;const button=document.createElement('button');button.type='button';button.textContent='[Test] Complete verification';button.onclick=()=>options.callback('fixture-token');el.append(button);options.callback('fixture-token');return 'fixture-widget';},reset(){}};`;
async function mockWidget(page: Page) {
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: widgetScript }),
  );
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
    await expect(page.locator('html')).toHaveAttribute('lang', locale!);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading!);
    expect(await page.locator('main').count()).toBe(1);
    const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
    expect(new URL(canonical!).pathname.replace(/\/$/, '') || '/').toBe(path);
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
  await page.getByRole('link', { name: 'ES', exact: true }).click();
  await expect(page).toHaveURL('/es/contact?utm_source=locale-test#inquiry');
  await expect(page.getByLabel('Nombre completo', { exact: true })).toHaveValue('Alex Buyer');
  await expect(page.getByLabel('Dirección de correo electrónico', { exact: true })).toHaveValue(
    'alex+quote@example.test',
  );
  await expect(page.getByLabel(/Mensaje \(opcional\)/)).toHaveValue(
    'Keep this inquiry\nwith its second line.',
  );
  await page.getByRole('link', { name: 'EN', exact: true }).click();
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
  await expect(
    page.getByText('Security verification failed to load.', { exact: true }),
  ).toBeVisible();
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
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Política de privacidad', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Privacidad — pendiente de completar',
  );
  await context.close();
});

test('mobile layout is keyboard usable and has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/contact');
  await dismissConsent(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveCount(1);
  await expect(page.getByLabel('Full name', { exact: true })).toBeVisible();
  await expect(page.locator('.privacy-notice')).toContainText(
    'Service. Privacy Policy · Terms of Service',
  );
  await page.screenshot({ path: 'test-results/contact-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
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
  await page.getByRole('link', { name: 'ES', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Sending...', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Full name', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Email address', { exact: true })).toBeDisabled();
  await expect(page.getByLabel(/Message \(optional\)/)).toBeDisabled();
  await page.locator('[data-inquiry-form]').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.getByRole('link', { name: 'ES', exact: true }).click();
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
  await expect(page.locator('[data-form-status]')).toContainText('Too many attempts');
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
  await page.getByRole('link', { name: 'ES', exact: true }).click();
  await expect(page).toHaveURL('/es/contact?source=current#inquiry');
  await expect(page.getByLabel('Nombre completo', { exact: true })).toHaveValue(
    'Current Location Buyer',
  );
  await expect(page.getByLabel('Dirección de correo electrónico', { exact: true })).toHaveValue(
    'current@example.test',
  );
  await page.getByRole('link', { name: 'EN', exact: true }).click();
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
    ['/contact', 'Full name', 'ES', 'Your browser cannot preserve this draft'],
    ['/es/contact', 'Nombre completo', 'EN', 'El navegador no permite conservar el borrador'],
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
  await page.getByRole('link', { name: 'ES', exact: true }).click();
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
  await page.getByRole('link', { name: 'EN', exact: true }).click();
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
