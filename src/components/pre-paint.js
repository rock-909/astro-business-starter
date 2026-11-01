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
}
