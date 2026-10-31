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
// Language suggestion pills (see syncLanguageSuggestion below).
const suggestions = [...document.querySelectorAll<HTMLElement>('[data-language-suggestion]')];
const suggestionArea = document.querySelector<HTMLElement>('[data-language-suggestions]');
const pageLocale = document.body.dataset.locale!;
// The page's hreflang alternates are the languages it really exists in (404 pages have none).
const pageLocales = [
  ...document.head.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]'),
]
  .map((link) => link.hreflang)
  .filter((tag) => tag !== 'x-default');
let gaInitialized = false;
const globals = window as unknown as Record<string, unknown>;
let gtag: ((...args: unknown[]) => void) | undefined;
// The control that reopened the card, so a choice can hand keyboard focus back to it.
let opener: HTMLElement | null = null;

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
  syncLanguageSuggestion();
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
  const hadFocus = banner.contains(document.activeElement);
  banner.hidden = true;
  if (hadFocus && opener?.isConnected) opener.focus();
  opener = null;
  syncLanguageSuggestion();
}
function reopen(trigger?: HTMLElement) {
  if (trigger) opener = trigger;
  else if (
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
  )
    opener = document.activeElement;
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
  syncLanguageSuggestion();
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
  button.closest<HTMLElement>('[data-open-consent-item]')!.hidden = false;
  button.addEventListener('click', () => reopen(button));
});
window.addEventListener('cookie-consent:open', () => reopen());
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

const themeSwitcher = document.querySelector<HTMLElement>('[data-theme-switcher]')!;
const themeButtons = [...themeSwitcher.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')];
themeSwitcher.hidden = false;
// Like the reference site, a first visit is light; visitors can still choose dark or the system.
function applyTheme(theme: string) {
  // Swap every colour at once instead of letting links and buttons fade through their transition.
  const root = document.documentElement;
  root.classList.add('theme-switching');
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const button of themeButtons)
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
  void getComputedStyle(root).color;
  requestAnimationFrame(() => root.classList.remove('theme-switching'));
}
function syncTheme() {
  let theme = 'light';
  try {
    theme = localStorage.getItem('theme') || 'light';
  } catch {
    /* Light is the default. */
  }
  if (!['light', 'dark', 'system'].includes(theme)) theme = 'light';
  applyTheme(theme);
}
for (const button of themeButtons)
  button.addEventListener('click', () => {
    const theme = button.dataset.themeChoice!;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* Preference still applies in this document. */
    }
    applyTheme(theme);
  });
window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === 'theme') syncTheme();
});
syncTheme();

// Language suggestion: when the browser prefers another registered language that this page
// also exists in, a pill offers it. Never at the same time as the cookie card.
function rememberLocale(locale: string) {
  try {
    localStorage.setItem('preferred-locale', locale);
  } catch {
    /* Without storage the choice is only not remembered. */
  }
}
function matchLocale(tag: string) {
  const browserTag = tag.toLowerCase();
  // Exact (en), then a browser region of a site language (es-MX → es), then a bare browser
  // language for a site region (pt → pt-BR). Regions are never swapped for one another.
  return (
    pageLocales.find((locale) => locale.toLowerCase() === browserTag) ??
    pageLocales.find((locale) => browserTag.startsWith(`${locale.toLowerCase()}-`)) ??
    pageLocales.find(
      (locale) => !browserTag.includes('-') && locale.toLowerCase().split('-')[0] === browserTag,
    )
  );
}
function preferredLocale() {
  try {
    const remembered = localStorage.getItem('preferred-locale');
    if (remembered && pageLocales.includes(remembered)) return remembered;
  } catch {
    /* Fall back to the browser languages. */
  }
  const { languages, language } = navigator;
  for (const tag of languages?.length ? languages : [language]) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return null;
}
function syncLanguageSuggestion() {
  const preferred = banner.hidden ? preferredLocale() : null;
  for (const suggestion of suggestions)
    suggestion.hidden =
      preferred === pageLocale || suggestion.dataset.languageSuggestion !== preferred;
}
for (const button of document.querySelectorAll('[data-language-dismiss]'))
  button.addEventListener('click', () => {
    rememberLocale(pageLocale);
    syncLanguageSuggestion();
  });
// Choosing a language anywhere (header or pill) remembers it, so the pill does not offer the
// language just left. Listening on the document runs after the links' own handlers, which
// cancel the switch while an inquiry is pending.
document.addEventListener('click', (event) => {
  const link =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('[data-locale-link]')
      : null;
  if (link && !event.defaultPrevented) rememberLocale(link.dataset.localeLink!);
});
window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === 'preferred-locale') syncLanguageSuggestion();
});
if (suggestionArea)
  // Footer space so the pill never covers the last controls when scrolled to the end.
  new ResizeObserver(() =>
    document.documentElement.style.setProperty(
      '--language-suggestion-space',
      `${suggestionArea.offsetHeight + 40}px`,
    ),
  ).observe(suggestionArea);

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
