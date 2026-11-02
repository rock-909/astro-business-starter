import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { securityHeaders } from '../src/security-headers.ts';
import { locales, localizedPath, pages } from '../src/site-routes.ts';
import { smokeIssues } from '../scripts/deploy-smoke.mjs';
import { startHarness } from './harness.mjs';
import { derivedRoot } from './derived-site.mjs';

// Each build is checked by its own copy of the script, so the derived site's page and
// language tables (English only, an extra About page) decide what is requested.
for (const root of ['.', derivedRoot]) {
  test(`deploy smoke passes against the built Worker without contacting a provider (${root})`, async () => {
    const script = pathToFileURL(resolve(root, 'scripts/deploy-smoke.mjs')).href;
    const { smokeIssues: smoke } = await import(script);
    const h = await startHarness({ root });
    try {
      assert.deepEqual(await smoke(h.url), []);
      assert.deepEqual(
        h.state.calls,
        [],
        'the smoke must not reach rate-limit, Turnstile, email or CRM',
      );
    } finally {
      await h.close();
    }
  });
}

test('deploy smoke reports a missing page, a missing header and an accepting inquiry endpoint', async () => {
  const { 'Content-Security-Policy': _csp, ...withoutCsp } = securityHeaders;
  const stripped = localizedPath(locales[0], pages[0].path);
  const missing = localizedPath(locales.at(-1), pages.at(-1).path);
  const server = createServer((request, response) => {
    if (request.url === missing) return response.writeHead(404, securityHeaders).end();
    if (request.method === 'POST')
      return response.writeHead(200, { ...securityHeaders, 'cache-control': 'no-store' }).end('{}');
    const headers = request.url === stripped ? withoutCsp : securityHeaders;
    response.writeHead(200, { ...headers, 'content-type': 'text/html' }).end('<!doctype html>');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const issues = await smokeIssues(`http://127.0.0.1:${server.address().port}`);
    assert.deepEqual(issues, [
      `${stripped}: Content-Security-Policy is null`,
      `${missing}: status 404, expected 200`,
      'POST /_actions/inquiry with an empty body: status 200, expected 400',
    ]);
  } finally {
    server.close();
  }
});
