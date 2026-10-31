/**
 * The one place languages and pages are registered. Everything else (routes, SEO,
 * navigation, the site schema, readiness and the inquiry Action) derives from these
 * tables. Pure data: no env, content or server imports, so `scripts/readiness.mjs`
 * and browser code can load it too.
 */

// The first language is the default and is served without a path prefix; every other
// language lives under `/<code>`. Each needs `src/content/<code>/` with its messages and
// every non-home page below. `label` is the switcher text, `name` its spoken name.
export const localeTable = {
  en: { label: 'EN', name: 'English', ogLocale: 'en_US' },
  es: { label: 'ES', name: 'Español', ogLocale: 'es_ES' },
} as const satisfies Record<string, { label: string; name: string; ogLocale: string }>;
export type Locale = keyof typeof localeTable;
export const locales = Object.keys(localeTable) as [Locale, ...Locale[]];
export const defaultLocale = locales[0];

export type PageKind = 'home' | 'contact' | 'legal' | 'content';
// `kind` picks the layout: `legal` pages get a table of contents beside the text,
// `content` pages are plain owner copy. `nav` places the link in the header and footer
// `main` column or the footer `support` column. Non-home pages read
// `src/content/<locale>/<key>.ts`.
export const pages = [
  { key: 'home', path: '/', kind: 'home', nav: 'main', sitemap: true },
  { key: 'contact', path: '/contact', kind: 'contact', nav: 'main', sitemap: true },
  { key: 'privacy', path: '/privacy', kind: 'legal', nav: 'support', sitemap: false },
  { key: 'terms', path: '/terms', kind: 'legal', nav: 'support', sitemap: false },
] as const satisfies readonly {
  key: string;
  path: string;
  kind: PageKind;
  nav?: 'main' | 'support';
  sitemap: boolean;
}[];
export type PageKey = (typeof pages)[number]['key'];

/** A root-relative site path in the given language. */
export function localizedPath(locale: Locale, path: string): string {
  return locale === defaultLocale ? path : `/${locale}${path === '/' ? '' : path}`;
}
/** The language a request path belongs to, by its prefix. */
export function localeOfPath(pathname: string): Locale {
  return (
    locales.find(
      (locale) =>
        locale !== defaultLocale &&
        (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)),
    ) ?? defaultLocale
  );
}
/** The same path with its language prefix removed. */
export function unlocalizedPath(pathname: string): string {
  // `/` for the default language, `/<code>` for the others.
  const prefix = localizedPath(localeOfPath(pathname), '/');
  return prefix === '/' ? pathname : pathname.slice(prefix.length) || '/';
}
