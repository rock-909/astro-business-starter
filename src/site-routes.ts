/**
 * The one place languages and pages are registered. Everything else (routes, SEO,
 * navigation, the site schema, readiness and the inquiry Action) derives from these
 * tables. Pure data: no env, content or server imports, so `scripts/readiness.mjs`
 * and browser code can load it too.
 */

// The first language is the default and is served without a path prefix; every other
// language lives under `/<code>`. Each needs `src/content/<code>/` with its messages and
// every non-home page below. `name` is the language's own name, shown in the switcher.
export const localeTable = {
  en: { name: 'English', ogLocale: 'en_US' },
  es: { name: 'Español', ogLocale: 'es_ES' },
} as const satisfies Record<string, { name: string; ogLocale: string }>;
export type Locale = keyof typeof localeTable;
export const locales = Object.keys(localeTable) as [Locale, ...Locale[]];
export const defaultLocale = locales[0];

export type PageKind = 'home' | 'contact' | 'legal' | 'content';
// `kind` picks the layout: `legal` and `content` pages get a table of contents beside
// the text when they have sections (h2), `contact` pages put the form beside it. `nav` places the link in the header and footer
// `main` column or the footer `support` column; the header shows the contact page as its
// call-to-action button instead of a navigation link. Non-home pages read
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

export type NavMenuLink = { page: PageKey } | { key: string; href: string; external: true };
export interface NavMenu {
  key: string;
  groups: readonly { key: string; links: readonly NavMenuLink[] }[];
}
// Header submenus, none by default. Each menu is a button after the page links that opens
// a full-width panel of grouped links on wide screens and a collapsible section in the
// phone menu; it does not navigate itself. A link is a registered page (named by its
// title) or an external https URL that opens in a new tab. Every language's messages
// name them under `navigation.menus`:
//   { key: 'products', groups: [{ key: 'machines', links: [{ page: 'about' },
//     { key: 'catalogue', href: 'https://…', external: true }] }] }
// needs `navigation.menus.products.label`, `….groups.machines` and `….links.catalogue`.
export const navMenus: readonly NavMenu[] = [];

const menuKey = /^[a-z][a-z0-9-]*$/;
/** What is wrong with the submenus or with one language's labels for them; empty when fine. */
export function navMenuIssues(
  locale: string,
  messages: unknown,
  menus: readonly NavMenu[] = navMenus,
): string[] {
  const issues: string[] = [];
  const text = (value: unknown) => typeof value === 'string' && value.trim() !== '';
  type Labels = {
    label?: unknown;
    groups?: Record<string, unknown>;
    links?: Record<string, unknown>;
  };
  const labels = (messages as { navigation?: { menus?: Record<string, Labels> } } | null)
    ?.navigation?.menus;
  const seen = new Set<string>();
  for (const menu of menus) {
    const where = `navigation.menus.${menu.key}`;
    if (!menuKey.test(menu.key) || seen.has(menu.key))
      issues.push(`Submenu key "${menu.key}" must be unique lowercase letters, digits and -`);
    seen.add(menu.key);
    if (!menu.groups.length) issues.push(`Submenu ${menu.key} needs at least one group`);
    const own = labels?.[menu.key];
    if (!text(own?.label)) issues.push(`${locale}/messages ${where}.label is missing`);
    for (const group of menu.groups) {
      if (!group.links.length) issues.push(`Submenu group ${menu.key}.${group.key} has no links`);
      if (!text(own?.groups?.[group.key]))
        issues.push(`${locale}/messages ${where}.groups.${group.key} is missing`);
      for (const link of group.links) {
        if ('page' in link) {
          if (!pages.some(({ key }) => key === link.page))
            issues.push(`Submenu ${menu.key} links unregistered page "${link.page}"`);
          continue;
        }
        let https = false;
        try {
          https = new URL(link.href).protocol === 'https:';
        } catch {
          /* Reported below. */
        }
        if (!https) issues.push(`Submenu link ${menu.key}.${link.key} must be an https URL`);
        if (!text(own?.links?.[link.key]))
          issues.push(`${locale}/messages ${where}.links.${link.key} is missing`);
      }
    }
  }
  return issues;
}

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
