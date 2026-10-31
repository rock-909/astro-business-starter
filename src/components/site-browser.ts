import { applyAttributionConsent } from './attribution';

type Consent = { necessary: true; analytics: boolean; advertising: boolean };
const denied: Consent = { necessary: true, analytics: false, advertising: false };
let choice = { ...denied };
const banner = document.querySelector<HTMLElement>('[data-cookie-banner]')!;
const choices = document.querySelector<HTMLElement>('#cookie-category-choices')!;
const customize = document.querySelector<HTMLButtonElement>('[data-consent-customize]')!;
const analytics = document.querySelector<HTMLInputElement>('[data-consent-analytics]')!;
const advertising = document.querySelector<HTMLInputElement>('[data-consent-advertising]')!;
const gaId = document.body.dataset.gaId || '';
let gaInitialized = false;
const globals = window as unknown as Record<string, unknown>;
let gtag: ((...args: unknown[]) => void) | undefined;

function signals(consent: Consent) {
  return {
    analytics_storage: consent.analytics ? 'granted' : 'denied',
    ad_storage: consent.advertising ? 'granted' : 'denied',
    ad_user_data: consent.advertising ? 'granted' : 'denied',
    ad_personalization: consent.advertising ? 'granted' : 'denied',
  };
}
function applyConsent(consent: Consent) {
  choice = consent;
  applyAttributionConsent(consent);
  if (!gaId || document.body.dataset.production !== 'true') return;
  globals[`ga-disable-${gaId}`] = !consent.analytics;
  if (!consent.analytics) {
    const labels = location.hostname.split('.');
    const domains = ['', ...labels.map((_, index) => `; domain=${labels.slice(index).join('.')}`)];
    for (const name of ['_ga', `_ga_${gaId.replace(/^G-/, '')}`])
      for (const domain of domains)
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
  }
  if (gaInitialized) gtag?.('consent', 'update', signals(consent));
  if ((!consent.analytics && !consent.advertising) || gaInitialized) return;
  const dataLayer: unknown[] = Array.isArray(globals.dataLayer) ? globals.dataLayer : [];
  globals.dataLayer = dataLayer;
  gtag = function (..._args: unknown[]) {
    dataLayer.push(arguments);
  };
  globals.gtag = gtag;
  gtag('consent', 'default', signals(denied));
  gtag('consent', 'update', signals(consent));
  gtag('js', new Date());
  const referrer = document.referrer ? new URL(document.referrer) : null;
  gtag('config', gaId, {
    page_path: location.pathname,
    page_location: `${location.origin}${location.pathname}`,
    page_referrer: referrer ? `${referrer.origin}${referrer.pathname}` : '',
    send_page_view: consent.analytics,
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
  script.dataset.analytics = 'true';
  document.head.append(script);
  gaInitialized = true;
}
function loadConsent(): Consent | null {
  try {
    const stored = JSON.parse(localStorage.getItem('cookie-consent') || 'null');
    if (
      stored?.version === 3 &&
      typeof stored.updatedAt === 'string' &&
      stored.consent?.necessary === true &&
      typeof stored.consent.analytics === 'boolean' &&
      typeof stored.consent.advertising === 'boolean'
    )
      return stored.consent;
    localStorage.removeItem('cookie-consent');
  } catch {
    /* Optional storage remains fail-closed. */
  }
  return null;
}
function syncConsent() {
  const stored = loadConsent();
  applyConsent(stored || { ...denied });
  banner.hidden = !!stored;
  analytics.checked = stored?.analytics || false;
  advertising.checked = stored?.advertising || false;
}
function choose(consent: Consent) {
  try {
    localStorage.setItem(
      'cookie-consent',
      JSON.stringify({ consent, updatedAt: new Date().toISOString(), version: 3 }),
    );
  } catch {
    /* The choice still applies to this document. */
  }
  applyConsent(consent);
  banner.hidden = true;
}
function reopen() {
  try {
    localStorage.removeItem('cookie-consent');
  } catch {
    /* Withdrawal still applies in this tab. */
  }
  applyConsent({ ...denied });
  analytics.checked = false;
  advertising.checked = false;
  choices.hidden = true;
  customize.setAttribute('aria-expanded', 'false');
  banner.hidden = false;
  customize.focus();
}
document
  .querySelector('[data-consent-accept]')
  ?.addEventListener('click', () =>
    choose({ necessary: true, analytics: true, advertising: true }),
  );
document
  .querySelector('[data-consent-reject]')
  ?.addEventListener('click', () => choose({ ...denied }));
document
  .querySelector('[data-consent-save]')
  ?.addEventListener('click', () =>
    choose({ necessary: true, analytics: analytics.checked, advertising: advertising.checked }),
  );
customize.addEventListener('click', () => {
  choices.hidden = !choices.hidden;
  customize.setAttribute('aria-expanded', String(!choices.hidden));
});
document.querySelectorAll<HTMLElement>('[data-open-consent]').forEach((button) => {
  // Hidden in the HTML so visitors without JavaScript are not offered a control that does nothing.
  button.hidden = false;
  button.addEventListener('click', reopen);
});
window.addEventListener('cookie-consent:open', reopen);
window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === 'cookie-consent') syncConsent();
});
syncConsent();
// Publish the card's footprint so CSS can keep focused controls scrolled above it.
new ResizeObserver(() =>
  document.documentElement.style.setProperty(
    '--cookie-banner-space',
    `${banner.offsetHeight + 24}px`,
  ),
).observe(banner);

const themeSelect = document.querySelector<HTMLSelectElement>('[data-theme-select]')!;
themeSelect.hidden = false;
function syncTheme() {
  let theme = 'system';
  try {
    theme = localStorage.getItem('theme') || 'system';
  } catch {
    /* System is the safe default. */
  }
  if (!['light', 'dark', 'system'].includes(theme)) theme = 'system';
  themeSelect.value = theme;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
themeSelect.addEventListener('change', () => {
  const theme = themeSelect.value;
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* Preference still applies in this document. */
  }
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
});
window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === 'theme') syncTheme();
});
syncTheme();

for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-locale-link]')) {
  const updateTarget = () => {
    const target = new URL(link.href);
    target.search = location.search;
    target.hash = location.hash;
    link.href = target.href;
  };
  updateTarget();
  // Read the current location for keyboard, primary, middle and context-menu activation.
  for (const event of ['click', 'auxclick', 'contextmenu'])
    link.addEventListener(event, updateTarget);
}
document.addEventListener('inquiry:accepted', () => {
  if (choice.analytics) gtag?.('event', 'generate_lead', { event_category: 'lead' });
});
document.addEventListener('click', (event) => {
  if (!choice.analytics || !(event.target instanceof Element)) return;
  const href = event.target.closest('a')?.getAttribute('href') || '';
  const channel = /^mailto:/i.test(href)
    ? 'email'
    : /^tel:/i.test(href)
      ? 'phone'
      : /^https:\/\/wa\.me\//i.test(href)
        ? 'whatsapp'
        : null;
  if (channel) gtag?.('event', 'contact_click', { event_category: 'lead', channel });
});
