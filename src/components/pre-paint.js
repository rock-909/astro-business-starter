// Inlined in <head>; the CSP allows this exact text by hash (see SiteLayout.astro).
{
  const root = document.documentElement;
  root.dataset.js = '';
  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'dark') root.dataset.theme = theme;
    else if (theme === 'system') delete root.dataset.theme;
  } catch {}
  try {
    if (!localStorage.getItem('cookie-consent')) root.dataset.consentPending = '';
  } catch {
    root.dataset.consentPending = '';
  }
  // The language bar above the header, decided before first paint so it never pushes the
  // page down later. Same choice as site-browser.ts: a remembered language, else the first
  // browser language this page exists in (its hreflang alternates, which come before this).
  const pageLocales = [...document.querySelectorAll('link[rel="alternate"][hreflang]')]
    .map((link) => link.hreflang)
    .filter((tag) => tag !== 'x-default');
  let preferred = null;
  try {
    const remembered = localStorage.getItem('preferred-locale');
    if (pageLocales.includes(remembered)) preferred = remembered;
  } catch {}
  const { languages, language } = navigator;
  for (const tag of preferred ? [] : languages?.length ? languages : [language]) {
    const browserTag = tag.toLowerCase();
    preferred =
      pageLocales.find((locale) => locale.toLowerCase() === browserTag) ??
      pageLocales.find((locale) => browserTag.startsWith(`${locale.toLowerCase()}-`)) ??
      pageLocales.find(
        (locale) => !browserTag.includes('-') && locale.toLowerCase().split('-')[0] === browserTag,
      );
    if (preferred) break;
  }
  if (preferred && preferred !== root.lang) root.dataset.languageSuggest = preferred;
}
