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
