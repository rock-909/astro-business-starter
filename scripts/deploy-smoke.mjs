// Checks a deployed site from outside without sending an inquiry: every registered page
// in every language answers 200 with the security headers, and the inquiry Action
// rejects an empty request. The empty body fails Action input validation before the
// handler runs, so no rate-limit, Turnstile, email or CRM call is made. Passing does not
// prove that this commit is the version being served, that secrets are bound, or that
// inquiries are delivered (LAUNCH.md section 8).
//
//   node scripts/deploy-smoke.mjs https://www.example.com
import { fileURLToPath } from 'node:url';
import { securityHeaders } from '../src/security-headers.ts';
import { locales, localizedPath, pages } from '../src/site-routes.ts';

const request = (origin, path, init) =>
  fetch(new URL(path, origin), {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    ...init,
  });

/** What is wrong with the site at `origin`; empty when every check passes. */
export async function smokeIssues(origin) {
  const issues = [];
  const checkHeaders = (path, response) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      const actual = response.headers.get(name);
      if (actual !== value) issues.push(`${path}: ${name} is ${JSON.stringify(actual)}`);
    }
  };
  for (const locale of locales)
    for (const page of pages) {
      const path = localizedPath(locale, page.path);
      const response = await request(origin, path);
      await response.body?.cancel();
      if (response.status !== 200) issues.push(`${path}: status ${response.status}, expected 200`);
      else if (!response.headers.get('content-type')?.startsWith('text/html'))
        issues.push(`${path}: content-type ${response.headers.get('content-type')}`);
      checkHeaders(path, response);
    }
  // Served by the Worker, so this also checks src/security-headers.ts, not public/_headers.
  const action = '/_actions/inquiry';
  const response = await request(origin, action, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  await response.body?.cancel();
  if (response.status !== 400)
    issues.push(`POST ${action} with an empty body: status ${response.status}, expected 400`);
  if (response.headers.get('cache-control') !== 'no-store')
    issues.push(`POST ${action}: cache-control is ${response.headers.get('cache-control')}`);
  checkHeaders(`POST ${action}`, response);
  return issues;
}

/** A new version or custom domain can take a few minutes to answer everywhere. */
async function waitForHome(origin, attempts = 30, delayMs = 10_000) {
  for (let attempt = 1; ; attempt++) {
    let outcome;
    try {
      const response = await request(origin, '/');
      await response.body?.cancel();
      if (response.status === 200) return;
      outcome = `status ${response.status}`;
    } catch (error) {
      outcome = error.cause?.code ?? error.name;
    }
    console.log(`Waiting for ${origin}/ (attempt ${attempt}/${attempts}): ${outcome}`);
    if (attempt === attempts) throw new Error(`${origin}/ did not answer 200`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let origin;
  try {
    const url = new URL(process.argv[2] ?? '');
    if (url.protocol === 'https:' || url.protocol === 'http:') origin = url.origin;
  } catch {
    /* Reported below. */
  }
  if (!origin) {
    console.error(
      'Usage: node scripts/deploy-smoke.mjs <site URL, such as https://www.example.com>',
    );
    process.exit(2);
  }
  await waitForHome(origin);
  const issues = await smokeIssues(origin);
  if (issues.length) {
    console.error(`SMOKE FAILED for ${origin}\n` + issues.map((issue) => `- ${issue}`).join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      `Smoke passed for ${origin}: ${locales.length * pages.length} pages and the inquiry rejection. ` +
        'This is NOT proof of which version is served, bound secrets, or inquiry delivery.',
    );
}
