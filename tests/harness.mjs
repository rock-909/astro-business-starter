import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
// Use the EXACT Miniflare/workerd shipped by the pinned Wrangler/adapter, not a
// second, older simulator. This supported conversion bridges Miniflare 5's API.
const {
  Miniflare,
  convertV4MiniflareOptions,
  Response: MFResponse,
} = createRequire(require.resolve('wrangler'))('miniflare');

export const fixtureEnv = {
  APP_ENV: 'test',
  PUBLIC_SITE_URL: 'https://example.invalid',
  TURNSTILE_SECRET_KEY: 'fixture-turnstile-secret-never-real',
  TURNSTILE_ALLOWED_HOSTS: 'example.invalid,127.0.0.1,localhost',
  RESEND_API_KEY: 'fixture-resend-secret-never-real',
  RESEND_FROM_EMAIL: 'sender@example.invalid',
  INQUIRY_TO_EMAIL: 'owner@example.invalid',
  AIRTABLE_API_KEY: 'fixture-airtable-secret-never-real',
  AIRTABLE_BASE_ID: 'appFixture',
  AIRTABLE_TABLE_NAME: 'Leads',
  UPSTASH_REDIS_REST_URL: 'https://rate-limit.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'fixture-upstash-secret-never-real',
  RATE_LIMIT_PEPPER: 'fixture-rate-limit-pepper-with-more-than-32-characters',
};
const json = (body, status = 200) =>
  new MFResponse(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
// The shared suites send many requests from one fixture IP, so the native limiter
// gets a high default; pass nativeLimit: 'deployed' to use the wrangler.jsonc limit.
export async function startHarness({
  port = 0,
  bindings = {},
  root = '.',
  nativeLimit = 1_000_000,
} = {}) {
  const server = resolve(root, 'dist/server');
  // The generated deploy config, so binding names and limits match what deploys.
  const deployed = JSON.parse(readFileSync(resolve(server, 'wrangler.json'), 'utf8'));
  const ratelimits = Object.fromEntries(
    deployed.ratelimits.map(({ name, namespace_id, simple }) => [
      name,
      {
        namespace_id,
        simple: { ...simple, limit: nativeLimit === 'deployed' ? simple.limit : nativeLimit },
      },
    ]),
  );
  const state = {
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
  };
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'astro-business-starter-test',
      modulesRoot: server,
      modules: [
        {
          type: 'ESModule',
          path: resolve(server, 'test-transport.mjs'),
          // Node fetch refuses mismatched Content-Length. Set it inside workerd,
          // then invoke the unchanged generated entry and registered Action.
          // This virtual module exists only in the test harness, never the build.
          contents: `
          import app from './entry.mjs';
          export default { async fetch(request, env, context) {
            if (request.headers.has('x-test-content-length')) {
              const headers = new Headers(request.headers);
              headers.set('content-length', headers.get('x-test-content-length'));
              headers.delete('x-test-content-length');
              request = new Request(request, { headers });
            }
            // Makes a platform API throw a plain Error so the unchanged handler
            // meets an unexpected (non-ActionError) exception.
            const fault = request.headers.get('x-test-platform-fault');
            if (!fault) return app.fetch(request, env, context);
            const getRandomValues = crypto.getRandomValues;
            crypto.getRandomValues = () => { throw new Error(fault); };
            try {
              return await app.fetch(request, env, context);
            } finally {
              crypto.getRandomValues = getRandomValues;
            }
          }};
        `,
        },
        ...readdirSync(server, { recursive: true })
          .filter((path) => path.endsWith('.mjs') && !path.startsWith('.'))
          .map((path) => ({
            type: 'ESModule',
            path: resolve(server, path),
          })),
      ],
      compatibilityDate: '2026-10-19',
      compatibilityFlags: ['nodejs_compat'],
      host: '127.0.0.1',
      port,
      cf: false,
      bindings: { ...fixtureEnv, ...bindings },
      ratelimits,
      // Worker console lines, for asserting log categories (never buyer data).
      handleStructuredLogs: ({ level, message }) => state.logs.push({ level, message }),
      assets: {
        directory: resolve(root, 'dist/client'),
        binding: 'ASSETS',
        routerConfig: { has_user_worker: true },
        assetConfig: {
          html_handling: 'drop-trailing-slash',
          not_found_handling: 'none',
        },
      },
      outboundService: async (request) => {
        const url = new URL(request.url);
        const raw = await request.text();
        const call = {
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body: raw,
          at: Date.now(),
        };
        state.calls.push(call);
        if (url.origin === 'https://rate-limit.invalid' && url.pathname === '/multi-exec') {
          if (state.rate === 'throw') throw new Error('fixture boundary unavailable');
          if (state.rate === 'malformed') return json({ bad: true });
          return json([{ result: state.rateCount }, { result: 1 }, { result: state.rateTtl }]);
        }
        if (
          url.origin === 'https://challenges.cloudflare.com' &&
          url.pathname === '/turnstile/v0/siteverify'
        ) {
          if (state.turnstile === 'throw') throw new Error('fixture boundary unavailable');
          if (state.turnstile === 'malformed') return new MFResponse('bad json');
          if (state.turnstile === 'reject')
            return json({
              success: false,
              'error-codes': ['invalid-input-response'],
            });
          if (state.turnstile === 'unavailable')
            return json({ success: false, 'error-codes': ['internal-error'] });
          return json({
            success: true,
            ...(state.turnstile !== 'missing-host'
              ? {
                  hostname:
                    state.turnstile === 'wrong-host' ? 'attacker.invalid' : 'example.invalid',
                }
              : {}),
            ...(state.turnstile !== 'missing-action'
              ? {
                  action: state.turnstile === 'wrong-action' ? 'other_action' : 'product_inquiry',
                }
              : {}),
          });
        }
        const provider =
          url.origin === 'https://api.resend.com' && url.pathname === '/emails'
            ? 'email'
            : url.origin === 'https://api.airtable.com' && url.pathname === '/v0/appFixture/Leads'
              ? 'airtable'
              : null;
        if (!provider) throw new Error('Unexpected outbound request blocked by test harness');
        if (state.onDelivery) await state.onDelivery(provider);
        if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
        if (state[provider] === 'throw') throw new Error('fixture response lost after acceptance');
        if (state[provider] === 'reject') return json({ error: 'rejected' }, 503);
        if (state[provider] === 'missing-id')
          return json(provider === 'email' ? {} : { records: [{}] });
        if (state[provider] === 'blank-id')
          return json(provider === 'email' ? { id: ' ' } : { records: [{ id: ' ' }] });
        return json(
          provider === 'email' ? { id: 'fixture-email-id' } : { records: [{ id: 'recFixture' }] },
        );
      },
    }),
  );
  await mf.ready;
  return { mf, state, url: String(await mf.ready), close: () => mf.dispose() };
}

export const validInput = {
  fullName: 'Alex Buyer',
  email: 'alex+quote@example.com',
  message: 'First line\nSecond line',
  locale: 'en',
  turnstileToken: 'fixture-token',
};
export async function action(harness, payload = validInput, options = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return harness.mf.dispatchFetch(`http://localhost${options.path || '/_actions/inquiry'}`, {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.20',
      ...options.headers,
    },
    body,
    ...options.init,
  });
}
export function deliveries(state) {
  return state.calls.filter((call) => /api\.(resend|airtable)\.com/.test(call.url));
}
/** Worker log lines matching a category, after giving workerd's log pipe time to flush. */
export async function logsMatching(state, pattern, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let found = state.logs.filter(({ message }) => pattern.test(message));
  while (!found.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    found = state.logs.filter(({ message }) => pattern.test(message));
  }
  return found.map(({ message }) => message);
}
