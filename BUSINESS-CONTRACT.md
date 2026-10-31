# Website behavior contract

The reference has Home, Contact, Privacy and Terms in English and Spanish, not a product catalog. The default identity, domain, mailbox and legal copy remain explicit placeholders. No supplier facts, products or operational promises are invented.

## Preserved observable contracts

| Area | Contract and implementation |
|---|---|
| Journeys | `/`, `/contact`, `/privacy`, `/terms` and `/es` equivalents. Static readable HTML, one `main`, localized nav/footer, equivalent locale links retaining query/hash, same-tab draft recovery. Unknown/legacy product paths return real localized 404. No browser-language redirect. |
| Content/derivation | Adapted EN/ES reference prose/messages with neutral branding; editable `src/site-data.json` identity/SEO/company/contact/social/assets with shape validation. Optional empty facts omitted. Source-derived content block parser supports editable paragraphs/headings/lists/tables/links, not a special contact paragraph. |
| UI | Native controls, visible focus, responsive layout, localized status/field associations; persisted light/dark/system preference. Native UI/plain CSS are experiment choices, not an anti-React policy or measured performance comparison. |
| Buyer input | Required sanitized name ≤100 and email ≤254; optional multiline message ≤2,000; locale only EN/ES. Preserve plus-addressing, lowercase validated email, retain useful line breaks. First permitted touch per consent category: analytics allows five UTM values and landing/time; advertising allows gclid/wbraid/gbraid. Unsafe values dropped and allowed values bounded. Server fixes type and strips unknown/security fields. |
| Admission | JSON `POST /_actions/inquiry`; exact JSON media type with optional parameters, same-origin browser requests, object JSON and ≤65,536 actual bytes before parsing. No-Origin callers still pass every remaining gate. Origin/media/body rejection precedes rate storage. No public token-consuming preflight. |
| Abuse | 10/minute source rate policy, hashed edge-IP keys, IPv6 /64 grouping; arbitrary X-Forwarded-For ignored. True excess gives 429/Retry-After. Store/key/config outage is intentionally fail-open **only for rate limiting**, not Turnstile. Nonempty honeypot returns synthetic success/reference with no verification or deliveries; not a received lead. |
| Turnstile | Server checks token, provider boolean, allowed hostname and `product_inquiry` action. Required/rejected/unavailable categories distinct. Missing config and official always-pass secret keys cannot bypass verification. No app test switch/provider URL override. |
| Delivery | Email/Airtable start independently in parallel, same reference. Nonempty expected provider ID plus successful HTTP status is acceptance; either acceptance means buyer success. Both unconfirmed gives DELIVERY_UNCONFIRMED. No partialSuccess, automatic retry, queue, deduplication or exactly-once promise. |
| External schema | Email reply-to/name/message/locale/all attribution. Airtable: Email, Submitted At, Status=New, Source=Website Inquiry, First Name, Last Name, Message, Reference ID; optional Requirements and seven UTM/landing/time fields. Click IDs/locale email-only. HTML escaping and spreadsheet-prefix defense retained. |
| Recovery | Pending locks submission and buyer edits; locale navigation waits. Failure retains fields/draft; only recognized success clears them. Token reset after settlement/expiry. Browser timeout/lost response never claims nothing was sent; manual retry may duplicate. No-JS content/explanation remain, protected submit stays disabled, mailbox rescue appears only if actually configured. |
| Consent | Analytics/advertising default denied; equal accept/reject, granular choice, persistence, withdrawal/reopen, cross-tab sync. Inquiry remains available without optional consent. Rejection/withdrawal stops collection and removes that category's browser attribution from subsequent submissions, including after refresh or locale navigation. It does not delete email/CRM records already submitted. Configured production GA loads only after consent; withdrawal disables it and clears GA cookies. Both page location and referrer omit query/hash; lead/contact events contain no buyer PII. These are browser controls, not backend authorization or legal certification. |
| SEO/operations | Localized metadata, canonical, reciprocal hreflang/x-default, OG/Twitter PNG, safe JSON-LD without invented Organization. Nonproduction noindex/disallow. Placeholder legal pages excluded from sitemap/llms; home/contact produce four sitemap entries. Health nonsecret/no-store; static MIME/security headers and dynamic CSP/no-store. `/security-policy.txt` empty 404. No false operational security mailbox. |
| Launch truth | Production build blocked for missing/sentinel/malformed identity, legal and required configuration, leftover template copy in messages/contact content, and configured root-relative brand files missing from `public/`. Static readiness never proves credentials, legal sufficiency, inbox arrival or deployment. |

## Astro-specific decisions

1. **Actions first, not dogmatic.** One registered Action owns inquiry and native serialization; ordinary endpoints serve health/robots/sitemap/llms. Old internal Next `/api/inquiry` has no established external consumer, so no extra compatibility writer was added.
2. **Static content, dynamic writer.** `output:'server'` retains the exact Action manifest setting; eight content pages and SEO text/XML routes explicitly prerender. The official `prerenderEnvironment:'node'` option renders static content in Node. Runtime tests still run the generated Cloudflare Worker in workerd.
3. **Native parsing where it holds.** Installed Astro 7.4.2 `actionBodySizeLimit:65536` counts streams for absent/nonfinite Content-Length. Its finite-header branch trusts the declaration; a narrow middleware supplement counts actual bytes on that branch. Runtime tests cover the accepted size boundary and oversized/misdeclared bodies. This preserves an explicit inherited acceptance condition, not a new theoretical policy.
4. **Native UI after accounting for states.** Four-page navigation, form, theme and consent currently have no concrete need for a component-library state model. Small browser modules and CSS tokens cover the actual states. No React/Tailwind comparative benchmark was performed. React islands and/or Tailwind remain reasonable when derived UI/team workflow creates a real consumer; smaller dependency count alone is not proof of superiority.

## Transport mapping

- 200 `application/json+devalue`: `actions.inquiry()` decodes `{success:true,referenceId}`.
- 400 canonical fields: supported `ActionError.message` JSON `{code:'INQUIRY_VALIDATION_FAILED',fields:[...]}`; client allowlists fields and uses localized copy, never raw provider text.
- 400 TURNSTILE_REQUIRED/REJECTED; 503 TURNSTILE_UNAVAILABLE/DELIVERY_UNCONFIRMED; 429 RATE_LIMIT_EXCEEDED plus actual Retry-After.
- Admission: 403 bad origin, 415 media, 400 malformed/nonobject, 413 oversized. Unknown Action 404. Static page POST native-form invocation 405 precedes app execution; dynamic native invocations still pass middleware.
- Browser uses a conservative 60-second rate cooldown; API reports actual TTL. Unrecognized/lost result stays unknown, not confirmed failure or success.

## Unchanged safety and proof boundaries

Only external boundaries are faked by `tests/harness.mjs`; unknown outbound destinations are rejected. Browser widget/GA scripts are fixtures. No production bypass exists. Mock acceptance is not inbox receipt, real CRM persistence, real Turnstile usability or deployment. Duplicates remain accepted; a lock/reference is not idempotency or durable recovery. No outbox or speculative race/security machinery was added.

No placeholder security mailbox is advertised as an operational disclosure contact; unconfigured `/.well-known/security.txt` remains 404.

See AGENTS.md for project guidance, PROVENANCE.md for source adoption, and ACCEPTANCE.md for observed validation.
