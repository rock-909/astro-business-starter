# Validation summary

Post-audit source verified on **2026-10-25 UTC**. These are local/mock results, not production certification.

## Observed final run

| Check | Result |
|---|---|
| `npm run check` | PASS — 38 files; 0 errors, warnings or hints |
| `npm run build:test` | PASS — generated Cloudflare Worker; 11 prerendered outputs |
| `npm test` | PASS — 28 tests, including the actual registered Astro Action in workerd and isolated real configuration builds |
| `npm run test:browser` | PASS — 26 browser tests |
| `npm run verify` | PASS — complete aggregate command exited 0 |
| `npm run readiness` | Expected exit 1 — placeholder identity/legal text and missing real configuration |
| `PUBLIC_APP_ENV=production npm run build` | Expected exit 1 — production readiness guard blocks the default template |
| `.env` / mode / shell production configuration | PASS — template refusal and precedence verified by real builds; syntax-only configured production also builds without exposing inert server values in client assets |
| Public source review | No real credentials, private repository identifiers, internal paths or source snapshots included |
| Branding assets | Updated site/package/Worker names and regenerated OG image; desktop and OG rendering visually checked |

The audit fixes environment/readiness and optional company configuration, current-URL locale navigation, active input contrast and analytics referrer cleaning. A separately approved policy change gates attribution by analytics/advertising consent while keeping inquiry available without either. Local cleanup consolidates form limits, removes unused content/message fields, simplifies a guarded IPv6 segment parser and improves source formatting. No provider framework, queue, automatic retry or idempotency mechanism was added. The source archive contains runnable tests and a SHA-256 file manifest, not internal execution logs, dependencies, screenshots or build outputs.

## Prettier format check (2026-10-29 UTC)

| Check | Result |
|---|---|
| `npm run format:check` after `npm ci` | PASS — exit 0, all matched files use Prettier code style |
| Unformatted counterexample (`export const  x={a:1}` appended to `src/lib/text.ts`, then reverted) | Expected exit 1 — `prettier --check .` reports the file |
| `.astro` parsing | `prettier --file-info src/layouts/SiteLayout.astro` infers the `astro` parser from `prettier-plugin-astro` |
| `npm run check` | PASS — 0 errors, warnings or hints |
| Reference search (`git grep format:check prettier`) | `package.json` scripts and devDependencies, `prettier.config.mjs`, `.github/workflows/ci.yml` step `Format check`, `.no-mistakes.yaml` `lint`, `.claude/rules/testing-runtime.md` command table |

Markdown, YAML, `.claude/` and the lockfile are excluded by `.prettierignore`. The reformat commit is mechanical `prettier --write .` output; the build, node and browser regression results for it come from the `verify` run, not from this section.

## Launch-safety readiness and Workers Logs (2026-10-30 UTC)

Node 24.22.1, dependencies from `npm ci`. "Before" runs replace only `scripts/readiness.mjs` with the named revision and keep the current tests.

| Check | Result |
|---|---|
| `node --test --test-name-pattern="readiness rejects (shipped template\|configured root)" tests/config.test.mjs` | PASS — 2 tests |
| Same, `scripts/readiness.mjs` from base `ca6eea6` | Expected FAIL — template-copy test (no `messages`/`contact` issues reported) and brand-file test (`[]` instead of the three `brandAssets.ogImage`/`favicon`/`logo.horizontal` issues) |
| Same, `scripts/readiness.mjs` from `31fbab3` (whole-file `contact.ts` match) | Expected FAIL — template-copy test |
| `contact.ts` rewritten (with `import type` and `satisfies`) but keeping the comment `// Replaced reference site copy`, through `readinessIssues` | `31fbab3`: `en/contact` and `es/contact` reported; fixed: none |
| `node --test --test-name-pattern="real Astro builds" tests/config.test.mjs` | PASS — 5 real builds, including the ready production build with the rewritten `contact.ts` |
| `npm run readiness` on the template | Expected exit 1 — lists each `en/contact` and `es/contact` string with template copy, among other issues |
| `wrangler.jsonc` through Wrangler 4.153.0 `unstable_readConfig` | `observability` = `{"enabled":true,"logs":{"invocation_logs":false}}`, no warnings; a copy with the typo `invocation_log` warns `Unexpected fields found in observability field` |
| Reference search (`git grep -n "observability\\|invocation_logs"`) | Only `wrangler.jsonc`; retention and cost in `LAUNCH.md` section 6 |

`npm run verify` was not run in this fix round. None of these checks prove live Workers Logs, provider delivery or deployment.

## Inquiry and configuration robustness (2026-10-30 UTC)

Node 24.22.1. "Before" runs replace only `src/lib/inquiry.ts`, `src/middleware.ts`, `src/actions/index.ts`, `src/site-schema.ts`, `scripts/readiness.mjs` and `wrangler.jsonc` with main `2d5a885`, rebuild with `npm run build:test` and keep the current tests.

| Check | Result |
|---|---|
| `npm test`, main `2d5a885` sources | Expected FAIL — 38 tests, 26 pass, 12 fail, including: ready production fixture `/missing` answers 500 instead of the localized 404 (ARCH-01); `/missing?_action=inquiry` answers 404 with `Retry-After: 60`, so the inquiry was processed (SEC-04); the `TURNSTILE_ALLOWED_HOSTS` variants, rate-limit configuration log, native pre-check, readiness hosts and founding-year tests |
| `CI=1 npm run verify`, fixed sources | PASS — exit 0; `astro check` 0 errors, `npm test` 38/38, browser 28/28 |
| SEC-05 scratch check (`throw new Error('Invalid API key re_CANARY')` temporarily injected, then reverted) | main: the message returned raw in a 500 body; fixed: `INTERNAL_ERROR`, log `inquiry.unexpected_error` |
| SEC-05 regression `node --test --test-name-pattern="unexpected handler exception" tests/action.test.mjs`, main `src/actions/index.ts` | Expected FAIL — body message `Invalid API key re_FIXTURE_CANARY` instead of `INTERNAL_ERROR` |
| Same, fixed `src/actions/index.ts` | PASS |
| `node --test tests/action.test.mjs` after `npm run build:test`, fixed sources | PASS — 26 tests |

The SEC-05 regression goes through the registered Action in workerd: for requests carrying `x-test-platform-fault`, the test-only transport wrapper makes `crypto.getRandomValues` throw a plain `Error` (used by the honeypot reference ID), then restores it. It asserts status 500, message `INTERNAL_ERROR`, no marker in the body or Worker logs, and that `TURNSTILE_REQUIRED` keeps its code and message. The wrapper is not emitted in application artifacts. `npm run verify` was not re-run after adding this test. None of these checks prove live providers or deployment.

## D3 interface options O1–O7, UI-12, UI-13 (2026-10-30 UTC)

Node 24.22.1, dependencies from `npm ci`, `CI=1`, Playwright's cached Chromium headless shell. The "before" run restores only `src/` from base `a043e80`, keeps this branch's tests and rebuilds with `npm run build:test`.

| Check | Result |
|---|---|
| `npm run check`, fixed sources | PASS — 0 errors, 0 warnings, 0 hints |
| `npm run build:test`, fixed sources | PASS |
| `npm test`, fixed sources | PASS — 45/45 |
| `npx playwright test`, fixed sources | PASS — 40/40 |
| `npm run format:check` | PASS — all matched files use Prettier code style |
| `npx playwright test`, base `a043e80` `src/` | Expected FAIL — 34 pass, 6 fail: 404 recovery (no `/es/contact` link), EN/ES submissions (no `Done:` prefix), mobile keyboard layout (button text `Send inquiry↗`), header current/hover (`none auto` instead of `underline 2px`), contact aside (repeats `Share your requirement…`), server email rejection (no `Error:` prefix) |

`npm run verify` was not run as one aggregate command. The test build configures no contact, so the configured-contact aside intro is not exercised; the success-state appearance was not screenshotted. None of these checks prove live providers or deployment.

## b2b design tokens and base typography, PR1 (2026-10-31 UTC)

Node 24.22.1, dependencies from `npm ci`, `CI=1`, `TEST_PORT=5271`, Playwright's cached Chromium. Counterexamples replace only the named source and rebuild with `npm run build:test`; every replacement was reverted and rebuilt before the final run.

| Check | Result |
|---|---|
| `npm run check`, `74d2e2d` (run by the author) | PASS — 0 errors, 0 warnings, 0 hints |
| `npm run build:test`, `74d2e2d` (run by the author) | PASS |
| `npm test`, `74d2e2d` (run by the author) | PASS — 51/51 |
| `npm run test:browser`, `74d2e2d` (run by the author) | PASS — 87 passed |
| `npm run verify` and `npm run format:check`, `74d2e2d` (run by the author) | PASS — exit 0 |
| Counterexample on `c95b58c` (run by the author): link reset removed so `a` keeps the browser underline, `data-theme="light"` removed from `<html>`, `syncTheme` defaulting to `system` | Expected FAIL — header current/hover conventions, first-visit-light and footer/in-content-link tests in both template and derived projects; PASS again after revert |
| `npx playwright test -g "unknown routes give localized 404"`, with the 404 primary and outline buttons asserted at 40px | PASS — 2/2 (template, derived) |
| Same, `src/styles/global.css` from `c95b58c` (`min-height` buttons) | Expected FAIL — 2/2: outline button `Received: 42`, `Expected: 40` in both projects |
| `npm run test:browser`, final sources with the 404 height assertion | PASS — 87 passed, 3 skipped |
| `npx prettier --check tests/ui.spec.ts` | PASS |
| Reference search (`git grep -nF` for `eyebrow`, `secondary`, `--surface`, `--soft`, `--focus`, `--on-primary`, `--input-border`, excluding this file and the lockfile) | No users left; only the new `--surface-radius` token and the comment `Outline buttons are secondary actions` in `src/styles/global.css` |

`npm run check`, `npm test` and `npm run verify` were not re-run after adding the 404 height assertion, which changes only `tests/ui.spec.ts`. None of these checks prove live providers or deployment.

## What the tests exercise

- All eight English/Spanish content routes, localized 404, canonical/hreflang metadata, SEO endpoints, health and static MIME/security headers.
- Canonical validation and normalization, actual-byte size limits, origin/media/body admission, rate limiting and its documented outage behavior.
- Honeypot behavior and Turnstile rejection/missing configuration/hostname/action/outage cases without an application bypass.
- Independent parallel email/CRM acceptance, missing provider IDs, unconfirmed delivery, response loss and explicit duplicate semantics.
- Draft recovery, pending edits/duplicate protection, localized field errors/focus, manual retry, rate cooldown and fresh verification.
- Theme and consent persistence/withdrawal/cross-tab synchronization; optional analytics loading and clean-URL behavior through fixtures.
- Default-denied, analytics-only, advertising-only and combined attribution; category withdrawal, refresh and locale navigation do not restore disallowed browser records; actual inquiry succeeds in every consent state.
- Current hash/query locale switching with drafts, optional company configurations and invalid field types, required nonblank identity/SEO, and editable field border contrast of at least 3:1 in both themes.
- No-JavaScript fallback, keyboard use and narrow-view layout.

Only external service boundaries are mocked. Browser tests use the built assets and real Worker. The lost-response test executes the Action, then discards its HTTP response; it does not forge a successful handler result. Test control is a separate loopback-only Node service and is not part of the app build.

The actual-byte regression sets a misdeclared Content-Length inside a test-only workerd transport wrapper, then calls the unchanged generated app. Removing only the middleware supplement makes the 65,537-byte case fail (200 instead of 413); restoring it passes. The wrapper is not emitted in application artifacts. The new defect regressions were also checked against the pre-fix source/output and failed for the reported behavior. Guarded IPv6 segment conversion matched the prior parser over 196,628 comparison inputs; focused valid/invalid and Worker grouping regressions remain in the suite.

## Reproduction environment

Node 24.22.1; npm 11.9.0; Astro 7.4.2; Cloudflare adapter 14.4.2; TypeScript 6.0.3; Wrangler 4.152.0; Playwright 1.64.1. The harness uses Wrangler's pinned Miniflare 5.20261019.2-beta/workerd 1.20261019.1.

Browser: Chromium headless-shell **153.0.8010.0**, provided separately by `@sparticuz/chromium` 153.0.0. This is not a claim about Playwright's default browser build or other browsers.

The final run used preinstalled dependencies and an existing browser, with `CI=1`, `npm_config_offline=true`, `npm_config_update_notifier=false`, `ASTRO_TELEMETRY_DISABLED=1`, `WRANGLER_SEND_METRICS=false` and `WRANGLER_HIDE_BANNER=true`. `CHROMIUM_PATH` selected the local browser; writable local logging/config directories were selected separately. These execution settings are not production application configuration.

## Not verified

No live Resend, Airtable, Turnstile, Upstash or GA validation; no inbox receipt or real CRM persistence; no Cloudflare deployment; no Safari/Firefox application suite or physical mobile-device run; no full assistive-technology/WCAG audit, search-engine indexing or React/Tailwind comparative benchmark. Official Firefox startup was blocked by profile access; WebKit startup was blocked by missing host libraries. Neither is an application incompatibility result, and no sandbox or host validation was relaxed. Passing mock tests does not close these gaps.

The five scoped rule files and all 48 `paths` patterns were checked against actual files, including new helpers/tests. Actual Claude rule loading was not verified; no compatibility bridge was added speculatively.
