// The one rule for a stored cookie-consent value: the categories of a current, complete
// choice, else null (a corrupt value throws). site-browser.ts imports it; SiteLayout.astro
// inlines it without `export` ahead of pre-paint.js, so the card is settled by the same rule
// before the first paint and an outdated record never shows the card late.
export const storedConsent = (raw) => {
  const stored = JSON.parse(raw || 'null');
  return stored?.version === 3 &&
    typeof stored.updatedAt === 'string' &&
    stored.consent?.necessary === true &&
    typeof stored.consent.analytics === 'boolean' &&
    typeof stored.consent.advertising === 'boolean'
    ? stored.consent
    : null;
};
