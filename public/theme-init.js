// The page is served light; a stored choice of dark or the system preference replaces that before paint.
try {
  const theme = localStorage.getItem('theme');
  if (theme === 'dark') document.documentElement.dataset.theme = theme;
  else if (theme === 'system') delete document.documentElement.dataset.theme;
} catch {}
