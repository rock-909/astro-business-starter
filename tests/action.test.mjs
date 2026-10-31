import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'devalue';
import { readFileSync, readdirSync } from 'node:fs';
import {
  startHarness,
  action,
  validInput,
  deliveries,
  fixtureEnv,
  logsMatching,
} from './harness.mjs';
import { readinessIssues } from '../scripts/readiness.mjs';
import {
  ipv4ToInteger,
  ipv6ToBigInt,
  ipv6NetworkPrefix64,
  ipv4MappedEmbeddedAddress,
} from '../src/lib/ip-range.ts';
import { securityHeaders } from '../src/security-headers.ts';

async function data(response) {
  const text = await response.text();
  return response.ok ? parse(text) : JSON.parse(text);
}

test('actual built Astro Action in pinned workerd: security and delivery contract', async (suite) => {
  const h = await startHarness();
  const reset = () =>
    Object.assign(h.state, {
      calls: [],
      logs: [],
      rateCount: 1,
      rateTtl: 60000,
      rate: 'accept',
      turnstile: 'accept',
      email: 'accept',
      airtable: 'accept',
      delay: 0,
      onDelivery: null,
    });
  try {
    await suite.test(
      'normalized shared payload, explicit IDs, exact Airtable fields, no security/unknown leakage',
      async () => {
        reset();
        const response = await action(h, {
          ...validInput,
          fullName: '  =Alex\tBuyer\u202e  ',
          email: 'Alex+Quote@EXAMPLE.COM',
          message: '  =SUM(A1)\r\n width < 900mm & "quoted"\n\n\nlast ',
          locale: 'es',
          utmSource: 'supplier',
          landingPage: '/contact',
          capturedAt: '2026-10-24T00:00:00.000Z',
          gclid: 'Click_123',
          unknown: 'do-not-deliver',
          website: '',
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const result = await data(response);
        assert.equal(result.success, true);
        assert.match(result.referenceId, /^INQ-/);
        assert.equal(h.state.calls.length, 4);
        const email = JSON.parse(deliveries(h.state)[0].body),
          airtable = JSON.parse(deliveries(h.state)[1].body).records[0].fields;
        assert.equal(email.reply_to, 'alex+quote@example.com');
        assert.equal(airtable.Email, email.reply_to);
        assert.equal(airtable['Reference ID'], result.referenceId);
        assert.match(email.subject, new RegExp(result.referenceId));
        assert.equal(airtable['First Name'], "'=Alex");
        assert.equal(airtable['Last Name'], 'Buyer');
        assert.equal(airtable.Requirements, '\'=SUM(A1)\nwidth < 900mm & "quoted"\n\nlast');
        assert.match(email.html, /width &lt; 900mm &amp; &quot;quoted&quot;/);
        assert.match(email.text, /Language: Español/);
        assert.match(email.text, /gclid: Click_123/);
        assert.equal(airtable.Source, 'Website Inquiry');
        assert.equal(airtable.Status, 'New');
        assert.equal(airtable['UTM Source'], 'supplier');
        assert.deepEqual(
          Object.keys(airtable).sort(),
          [
            'Captured At',
            'Email',
            'First Name',
            'Landing Page',
            'Last Name',
            'Message',
            'Reference ID',
            'Requirements',
            'Source',
            'Status',
            'Submitted At',
            'UTM Source',
          ].sort(),
        );
        for (const call of deliveries(h.state))
          assert.doesNotMatch(
            call.body,
            /fixture-token|do-not-deliver|turnstileToken|website|partialSuccess/,
          );
      },
    );

    await suite.test(
      'real canonical schema rejects buyer/locale/attribution errors without verification or delivery',
      async () => {
        for (const patch of [
          { fullName: '' },
          { fullName: 'x'.repeat(101) },
          { email: 'bad' },
          { email: 'x'.repeat(250) + '@example.com' },
          { message: 'x'.repeat(2001) },
          { message: 123 },
          { locale: 'fr' },
          { gclid: 'has spaces' },
          { utmSource: 'x'.repeat(257) },
        ]) {
          reset();
          const response = await action(h, { ...validInput, ...patch });
          assert.equal(response.status, 400);
          const error = await data(response);
          const detail = JSON.parse(error.message);
          assert.equal(detail.code, 'INQUIRY_VALIDATION_FAILED');
          assert.ok(detail.fields.length);
          assert.equal(h.state.calls.length, 1);
          assert.equal(deliveries(h.state).length, 0);
        }
      },
    );

    await suite.test(
      'unsafe attribution discarded rather than rejecting a valid lead; optional message allowed',
      async () => {
        reset();
        const response = await action(h, {
          ...validInput,
          message: undefined,
          utmSource: '<script>',
          utmCampaign: 123,
          unknown: true,
        });
        assert.equal(response.status, 200);
        const fields = JSON.parse(deliveries(h.state)[1].body).records[0].fields;
        assert.equal(fields.Requirements, undefined);
        assert.equal(fields['UTM Source'], undefined);
        assert.equal(fields['UTM Campaign'], undefined);
        assert.equal(fields.Message, 'General inquiry');
      },
    );

    await suite.test(
      'origin, media type, malformed and non-object JSON rejected before rate storage',
      async () => {
        const cases = [
          {
            payload: validInput,
            headers: { origin: 'https://attacker.invalid' },
            status: 403,
          },
          { payload: validInput, headers: { origin: 'null' }, status: 403 },
          {
            payload: validInput,
            headers: { origin: 'http://localhost/path' },
            status: 403,
          },
          {
            payload: validInput,
            headers: { 'content-type': 'text/plain' },
            status: 415,
          },
          {
            payload: validInput,
            headers: { 'content-type': 'application/jsonx' },
            status: 415,
          },
          ...['{', '[]', 'null', '42', '"text"', ''].map((payload) => ({
            payload,
            status: 400,
          })),
        ];
        for (const item of cases) {
          reset();
          const response = await action(h, item.payload, {
            headers: item.headers,
          });
          assert.equal(response.status, item.status);
          assert.equal(h.state.calls.length, 0);
        }
        reset();
        assert.equal(
          (
            await action(h, validInput, {
              headers: { 'content-type': 'application/json; charset=utf-8' },
            })
          ).status,
          200,
        );
        // Static assets do not execute native form Actions: the asset router rejects
        // POST with 405 before reaching Astro (dynamic routes use the origin gate).
        reset();
        assert.equal(
          (
            await action(h, validInput, {
              path: '/contact?_action=inquiry',
              headers: { origin: 'https://attacker.invalid' },
            })
          ).status,
          405,
        );
        assert.equal(h.state.calls.length, 0);
      },
    );

    await suite.test(
      'native ?_action= form calls on on-demand routes are refused before any processing',
      async () => {
        for (const path of [
          '/missing?_action=inquiry',
          '/es/missing?_action=inquiry',
          '/api/health?_action=inquiry',
        ]) {
          reset();
          h.state.rateCount = 11;
          const response = await action(h, validInput, { path });
          assert.equal(response.status, 404, path);
          assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
          assert.equal(response.headers.get('retry-after'), null);
          assert.equal(h.state.calls.length, 0, path);
        }
      },
    );

    await suite.test(
      'actual body byte limit protects streamed ASCII and UTF-8 before parsing',
      async () => {
        for (const body of [
          JSON.stringify({ ...validInput, message: 'a'.repeat(65536) }),
          JSON.stringify({ ...validInput, message: '世'.repeat(23000) }),
        ]) {
          reset();
          const response = await action(h, body);
          assert.equal(response.status, 413);
          assert.equal(h.state.calls.length, 0);
        }
      },
    );

    await suite.test('declared lengths cannot bypass the actual 65536-byte boundary', async () => {
      const empty = JSON.stringify({ ...validInput, padding: '' });
      const body = JSON.stringify({
        ...validInput,
        padding: 'x'.repeat(65536 - Buffer.byteLength(empty)),
      });
      assert.equal(Buffer.byteLength(body), 65536);
      for (const declared of [undefined, '65536', '2', '-1', 'NaN']) {
        reset();
        const headers = declared === undefined ? {} : { 'x-test-content-length': declared };
        const response = await action(h, body, { headers });
        assert.equal(response.status, 200, `accepted boundary; declared ${declared}`);
        assert.equal(deliveries(h.state).length, 2);
      }
      for (const declared of [undefined, '65537', '2', '0', '-1', 'NaN']) {
        reset();
        const headers = declared === undefined ? {} : { 'x-test-content-length': declared };
        const response = await action(h, body + ' ', { headers });
        assert.equal(response.status, 413, `oversized body; declared ${declared}`);
        assert.equal(h.state.calls.length, 0);
      }
    });

    await suite.test('edge IP rate buckets retain IPv6 /64 and mapped IPv4 semantics', async () => {
      const keys = [];
      for (const ip of [
        '2001:db8:1234:5678::1',
        '2001:0DB8:1234:5678:ffff::99',
        '2001:db8:1234:5679::1',
        '203.0.113.20',
        '::ffff:203.0.113.20',
      ]) {
        reset();
        const response = await action(
          h,
          { website: 'bot' },
          { headers: { 'cf-connecting-ip': ip } },
        );
        assert.equal(response.status, 200);
        const key = JSON.parse(h.state.calls[0].body)[0][1];
        assert.ok(!key.includes(ip));
        keys.push(key);
      }
      assert.equal(keys[0], keys[1]);
      assert.notEqual(keys[1], keys[2]);
      assert.equal(keys[3], keys[4]);
    });

    await suite.test('X-Forwarded-For cannot choose or change the rate bucket', async () => {
      const bucket = async (headers) => {
        reset();
        const response = await action(h, { website: 'bot' }, { headers });
        assert.equal(response.status, 200);
        return JSON.parse(h.state.calls[0].body)[0][1];
      };
      const edge = await bucket({ 'cf-connecting-ip': '203.0.113.20' });
      const spoofTarget = await bucket({ 'cf-connecting-ip': '198.51.100.7' });
      const noIdentity = await bucket({ 'cf-connecting-ip': '' });
      assert.notEqual(edge, spoofTarget);
      for (const forwarded of ['198.51.100.7', '198.51.100.7, 203.0.113.20', '2001:db8::1'])
        assert.equal(
          await bucket({ 'cf-connecting-ip': '203.0.113.20', 'x-forwarded-for': forwarded }),
          edge,
          `same edge IP keeps its bucket; x-forwarded-for ${forwarded}`,
        );
      const forwardedOnly = await bucket({
        'cf-connecting-ip': '',
        'x-forwarded-for': '198.51.100.7',
      });
      assert.notEqual(forwardedOnly, spoofTarget);
      assert.equal(forwardedOnly, noIdentity);
    });

    await suite.test(
      'true overlimit returns Retry-After; store outage is logged and continues Turnstile (not bypass)',
      async () => {
        reset();
        h.state.rateCount = 11;
        h.state.rateTtl = 12500;
        let response = await action(h);
        assert.equal(response.status, 429);
        assert.equal(response.headers.get('retry-after'), '13');
        assert.equal(h.state.calls.length, 1);
        reset();
        h.state.rate = 'malformed';
        h.state.turnstile = 'reject';
        response = await action(h);
        assert.equal(response.status, 400);
        assert.equal((await data(response)).message, 'TURNSTILE_REJECTED');
        assert.equal(h.state.calls.length, 2);
        assert.equal(deliveries(h.state).length, 0);
        assert.deepEqual(await logsMatching(h.state, /rate_limit_unavailable/), [
          "inquiry.rate_limit_unavailable { reason: 'storage' }",
        ]);
        reset();
        h.state.rate = 'malformed';
        assert.equal((await action(h)).status, 200);
        assert.equal(deliveries(h.state).length, 2);
      },
    );

    await suite.test(
      'honeypot synthetic reference skips verification and providers even with invalid buyer fields',
      async () => {
        reset();
        const response = await action(h, { website: 'bot.invalid' });
        assert.equal(response.status, 200);
        assert.match((await data(response)).referenceId, /^INQ-/);
        assert.equal(h.state.calls.length, 1);
      },
    );

    await suite.test(
      'Turnstile missing, rejection, hostname/action and provider outages stay distinct',
      async () => {
        reset();
        let response = await action(h, { ...validInput, turnstileToken: '' });
        assert.equal(response.status, 400);
        assert.equal((await data(response)).message, 'TURNSTILE_REQUIRED');
        assert.equal(h.state.calls.length, 1);
        for (const mode of [
          'reject',
          'wrong-host',
          'missing-host',
          'wrong-action',
          'missing-action',
          'malformed',
          'unavailable',
        ]) {
          reset();
          h.state.turnstile = mode;
          response = await action(h);
          const unavailable = ['malformed', 'unavailable'].includes(mode);
          assert.equal(response.status, unavailable ? 503 : 400);
          assert.equal(
            (await data(response)).message,
            unavailable ? 'TURNSTILE_UNAVAILABLE' : 'TURNSTILE_REJECTED',
          );
          assert.equal(deliveries(h.state).length, 0);
          if (unavailable)
            assert.deepEqual(await logsMatching(h.state, /turnstile_unavailable/), [
              "inquiry.turnstile_unavailable { reason: 'provider' }",
            ]);
        }
      },
    );

    await suite.test(
      'delivery matrix, 2xx without IDs, response loss and parallel independent starts',
      async () => {
        for (const [email, airtable, status] of [
          ['accept', 'accept', 200],
          ['accept', 'reject', 200],
          ['reject', 'accept', 200],
          ['reject', 'reject', 503],
          ['missing-id', 'missing-id', 503],
          ['blank-id', 'blank-id', 503],
          ['accept', 'throw', 200],
          ['throw', 'throw', 503],
        ]) {
          reset();
          h.state.email = email;
          h.state.airtable = airtable;
          let started = 0,
            release;
          const gate = new Promise((resolve) => {
            release = resolve;
          });
          h.state.onDelivery = async () => {
            if (++started === 2) release();
            await gate;
          };
          const response = await action(h);
          assert.equal(response.status, status);
          assert.equal(started, 2);
          assert.equal(deliveries(h.state).length, 2);
          if (status === 503) assert.equal((await data(response)).message, 'DELIVERY_UNCONFIRMED');
        }
      },
    );

    await suite.test(
      'duplicate submissions remain accepted independent leads (no fake idempotency promise)',
      async () => {
        reset();
        const first = await data(await action(h));
        const second = await data(await action(h));
        assert.notEqual(first.referenceId, second.referenceId);
        assert.equal(deliveries(h.state).length, 4);
      },
    );
  } finally {
    await h.close();
  }
});

test('absent production credentials/test secret cannot enable a verification bypass', async () => {
  for (const bindings of [
    { TURNSTILE_SECRET_KEY: '' },
    { TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' },
    { TURNSTILE_ALLOWED_HOSTS: '', PUBLIC_SITE_URL: '' },
    { TURNSTILE_ALLOWED_HOSTS: '*.example.invalid' },
  ]) {
    const h = await startHarness({ bindings });
    try {
      const response = await action(h);
      assert.equal(response.status, 503);
      assert.equal((await data(response)).message, 'TURNSTILE_UNAVAILABLE');
      assert.equal(deliveries(h.state).length, 0);
      assert.deepEqual(await logsMatching(h.state, /turnstile_unavailable/), [
        "inquiry.turnstile_unavailable { reason: 'configuration' }",
      ]);
    } finally {
      await h.close();
    }
  }
});

test('TURNSTILE_ALLOWED_HOSTS written as URLs, with a port or other separators still verifies', async () => {
  for (const hosts of [
    'https://example.invalid',
    'https://example.invalid/',
    'example.invalid:443',
    'www.example.invalid example.invalid',
    'www.example.invalid;EXAMPLE.invalid',
  ]) {
    const h = await startHarness({ bindings: { TURNSTILE_ALLOWED_HOSTS: hosts } });
    try {
      const response = await action(h);
      assert.equal(response.status, 200, hosts);
      assert.equal(deliveries(h.state).length, 2, hosts);
    } finally {
      await h.close();
    }
  }
});

test('rate-limit misconfiguration is logged apart from storage outages and still fails open', async () => {
  for (const bindings of [
    { RATE_LIMIT_PEPPER: 'too-short' },
    { UPSTASH_REDIS_REST_URL: '' },
    { UPSTASH_REDIS_REST_TOKEN: '' },
  ]) {
    const h = await startHarness({ bindings });
    try {
      const response = await action(h);
      assert.equal(response.status, 200);
      assert.equal(deliveries(h.state).length, 2);
      assert.ok(!h.state.calls.some((call) => call.url.startsWith('https://rate-limit.invalid')));
      assert.deepEqual(await logsMatching(h.state, /rate_limit_unavailable/), [
        "inquiry.rate_limit_unavailable { reason: 'configuration' }",
      ]);
    } finally {
      await h.close();
    }
  }
});

test('an unexpected handler exception returns INTERNAL_ERROR without leaking its message', async () => {
  const h = await startHarness();
  const marker = 'Invalid API key re_FIXTURE_CANARY';
  try {
    const response = await action(
      h,
      { website: 'bot.invalid' },
      { headers: { 'x-test-platform-fault': marker } },
    );
    const body = await response.text();
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(body).message, 'INTERNAL_ERROR');
    assert.ok(!body.includes('re_FIXTURE_CANARY'), body);
    assert.deepEqual(await logsMatching(h.state, /inquiry\.unexpected_error/), [
      'inquiry.unexpected_error',
    ]);
    assert.ok(!h.state.logs.some(({ message }) => message.includes('re_FIXTURE_CANARY')));

    const expected = await action(h, { ...validInput, turnstileToken: '' });
    assert.equal(expected.status, 400);
    assert.equal((await data(expected)).message, 'TURNSTILE_REQUIRED');
    assert.equal(deliveries(h.state).length, 0);
  } finally {
    await h.close();
  }
});

test('native rate-limit pre-check refuses an over-limit IP before the paid Upstash call', async () => {
  const h = await startHarness({ nativeLimit: 'deployed' });
  try {
    const statuses = [];
    for (let i = 0; i < 21; i++) {
      const response = await action(h, { website: 'bot' });
      statuses.push(response.status);
      if (response.status === 429) assert.equal(response.headers.get('retry-after'), '60');
    }
    const upstash = () =>
      h.state.calls.filter((call) => call.url.startsWith('https://rate-limit.invalid')).length;
    // The Upstash fixture never reports over-limit, so every 429 is the native pre-check.
    // 21 requests span at most two one-minute windows, so at most 20 pass.
    assert.equal(statuses[0], 200);
    assert.ok(statuses.includes(429), String(statuses));
    assert.equal(upstash(), statuses.filter((status) => status === 200).length);
    const before = upstash();
    const other = await action(
      h,
      { website: 'bot' },
      { headers: { 'cf-connecting-ip': '198.51.100.7' } },
    );
    assert.equal(other.status, 200);
    assert.equal(upstash(), before + 1);
  } finally {
    await h.close();
  }
});

// HSTS covers only the serving host; includeSubDomains/preload stay the domain owner's choice.
function assertIsolationHeaders(response) {
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
}

test('static assets, SEO endpoints, health, 404 and client secret boundary', async () => {
  const h = await startHarness();
  try {
    for (const path of [
      '/',
      '/contact',
      '/privacy',
      '/terms',
      '/es',
      '/es/contact',
      '/es/privacy',
      '/es/terms',
    ]) {
      const response = await h.mf.dispatchFetch(`http://localhost${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assertIsolationHeaders(response);
      const html = await response.text();
      assert.match(html, /noindex,nofollow/);
      assert.equal((html.match(/<main\b/g) || []).length, 1);
      assert.match(html, /rel="canonical"/);
    }
    const sitemap = await (await h.mf.dispatchFetch('http://localhost/sitemap.xml')).text();
    assert.equal((sitemap.match(/<url>/g) || []).length, 4);
    assert.doesNotMatch(sitemap, /privacy|terms|\/en\//);
    const llms = await (await h.mf.dispatchFetch('http://localhost/llms.txt')).text();
    assert.doesNotMatch(llms, /\/privacy|\/terms/);
    assert.match(llms, /Español/);
    assert.match(
      await (await h.mf.dispatchFetch('http://localhost/robots.txt')).text(),
      /Disallow: \/\n/,
    );
    const health = await h.mf.dispatchFetch('http://localhost/api/health');
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await health.json(), { status: 'ok' });
    const security = await h.mf.dispatchFetch('http://localhost/security-policy.txt');
    assert.equal(security.status, 404);
    assert.equal(await security.text(), '');
    const og = await h.mf.dispatchFetch('http://localhost/opengraph-image.png');
    assert.equal(og.status, 200);
    assert.match(og.headers.get('content-type'), /^image\/png/);
    assert.deepEqual(
      [...new Uint8Array(await og.arrayBuffer()).slice(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    const icon = await h.mf.dispatchFetch('http://localhost/icon.svg');
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get('content-type'), /^image\/svg\+xml/);
    for (const path of ['/missing', '/en/contact', '/products', '/es/missing']) {
      const response = await h.mf.dispatchFetch(`http://localhost${path}`);
      assert.equal(response.status, 404);
      assertIsolationHeaders(response);
    }
    const client = readdirSync('dist/client', { recursive: true })
      .filter((file) => /\.(js|html)$/.test(file))
      .map((file) => readFileSync(`dist/client/${file}`, 'utf8'))
      .join('\n');
    for (const [key, value] of Object.entries(fixtureEnv).filter(([key]) =>
      /SECRET|TOKEN|API_KEY|PEPPER/.test(key),
    )) {
      assert.ok(!client.includes(value), `${key} must not appear in client assets`);
      assert.ok(!client.includes(key), `${key} binding name must not enter browser code`);
    }
    assert.equal(h.state.calls.length, 0);
  } finally {
    await h.close();
  }
});

test('source template deliberately fails production readiness', () => {
  const issues = readinessIssues({});
  assert.ok(issues.some((issue) => issue.includes('owner')));
  assert.ok(issues.some((issue) => issue.includes('legal')));
  assert.ok(issues.some((issue) => issue.includes('TURNSTILE_SECRET_KEY')));
});

test('readiness rejects present but malformed delivery/rate/public configuration', () => {
  const issues = readinessIssues(
    {
      ...fixtureEnv,
      PUBLIC_SITE_URL: 'https://internal',
      RESEND_FROM_EMAIL: 'not-an-email',
      INQUIRY_TO_EMAIL: 'also-not-an-email',
      UPSTASH_REDIS_REST_URL: 'http://internal',
      PUBLIC_TURNSTILE_SITE_KEY: 'key',
    },
    {
      name: 'Confirmed business',
      description: 'Confirmed identity',
      contact: { email: 'not-an-email' },
      readiness: {
        ownerConfirmedIdentity: true,
        legalReviewed: { en: true, es: true },
      },
    },
  );
  for (const name of [
    'PUBLIC_SITE_URL',
    'RESEND_FROM_EMAIL',
    'INQUIRY_TO_EMAIL',
    'UPSTASH_REDIS_REST_URL',
    'contact.email',
    'TURNSTILE_ALLOWED_HOSTS',
  ])
    assert.ok(
      issues.some((issue) => issue.includes(name)),
      name,
    );
  assert.ok(
    !readinessIssues({
      RESEND_FROM_EMAIL: 'Sales Team <sales@supplier.co.uk>',
    }).some((issue) => issue.startsWith('RESEND_FROM_EMAIL')),
  );
});

test('readiness reads TURNSTILE_ALLOWED_HOSTS the way the Worker does', () => {
  const hostIssues = (TURNSTILE_ALLOWED_HOSTS) =>
    readinessIssues({ PUBLIC_SITE_URL: 'https://supplier.co.uk', TURNSTILE_ALLOWED_HOSTS }).filter(
      (issue) => issue.startsWith('TURNSTILE_ALLOWED_HOSTS'),
    );
  assert.deepEqual(hostIssues('https://supplier.co.uk/, www.supplier.co.uk:443'), []);
  assert.deepEqual(hostIssues('supplier.co.uk;www.supplier.co.uk'), []);
  assert.equal(hostIssues('supplier.co.uk, *.supplier.co.uk').length, 1);
  assert.equal(hostIssues('www.supplier.co.uk').length, 1);
});

test('IP parsing retains strict segments, compression and embedded IPv4', () => {
  for (const segment of ['0', '1', 'a', 'ABCD', 'ffff', '0001']) {
    assert.equal(ipv6ToBigInt(`::${segment}`), BigInt(`0x${segment}`));
  }
  for (const segment of [
    '',
    '00000',
    '10000',
    '-1',
    '+1',
    '0x1',
    ' 1',
    '1 ',
    '1\n',
    'g',
    'fffff',
    '１２',
    'é',
    'ß',
    '0.0',
    '1_0',
    '0XFF',
    '\0',
    '1\t',
  ]) {
    assert.equal(ipv6ToBigInt(`0:0:0:0:0:0:0:${segment}`), null, JSON.stringify(segment));
  }
  assert.equal(ipv6ToBigInt('::'), 0n);
  assert.equal(ipv6ToBigInt('1::2::3'), null);
  assert.equal(ipv6ToBigInt('1:2:3:4:5:6:7:8:9'), null);
  assert.equal(ipv6ToBigInt('1:2:3:4:5:6:7'), null);
  assert.equal(ipv4ToInteger('203.0.113.20'), 3405803796);
  for (const ip of ['203.00.113.20', '256.0.0.1', '1.2.3', '1.2.3.4x'])
    assert.equal(ipv4ToInteger(ip), null);
  assert.equal(ipv4MappedEmbeddedAddress('::ffff:203.0.113.20'), ipv4ToInteger('203.0.113.20'));
  assert.equal(ipv4MappedEmbeddedAddress('::ffff:cb00:7114'), ipv4ToInteger('203.0.113.20'));
  assert.equal(ipv4MappedEmbeddedAddress('2001:db8::1'), null);
  assert.equal(
    ipv6NetworkPrefix64('2001:db8:1234:5678::1'),
    ipv6NetworkPrefix64('2001:db8:1234:5678:ffff::99'),
  );
});

test('static hosting and dynamic Worker security headers remain identical', () => {
  const staticPolicy = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
    .split('/_astro/*')[0]
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const separator = line.indexOf(':');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    });
  assert.deepEqual(Object.fromEntries(staticPolicy), securityHeaders);
});
