/** Site identity, copy and page content, resolved from the registry in `site-routes.ts`. */
import identity from './site-data.json';
import { assertValidSiteConfig } from './site-schema';
import { locales, pages, localizedPath, type Locale, type PageKey } from './site-routes';
import type defaultMessages from './content/en/messages.json';

export {
  locales,
  pages,
  defaultLocale,
  localeTable,
  localeOfPath,
  localizedPath,
  unlocalizedPath,
  type Locale,
  type PageKey,
  type PageKind,
} from './site-routes';
export interface FaqItem {
  question: string;
  answer: string;
}
export interface ContentPage {
  metadata: {
    title: string;
    /** One visible sentence under the page title. */
    description?: string;
    updatedAt: string;
    seo: { title: string; description: string };
    /** Shown as plain questions and answers after the body, and as FAQPage structured data. */
    faq?: FaqItem[];
  };
  content: string;
}
export const site = {
  ...assertValidSiteConfig(identity),
  baseUrl: (import.meta.env.PUBLIC_SITE_URL || 'https://example.invalid').replace(/\/+$/, ''),
};
// Validate the actual public identity at build time; launch readiness is a separate gate.
const base = new URL(site.baseUrl);
if (
  !['https:', 'http:'].includes(base.protocol) ||
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  base.pathname !== '/'
)
  throw new Error('PUBLIC_SITE_URL must be an http(s) origin');
export function pathFor(locale: Locale, page: PageKey): string {
  return localizedPath(locale, pages.find((item) => item.key === page)!.path);
}
export function canonical(locale: Locale, page: PageKey): string {
  return new URL(pathFor(locale, page), site.baseUrl).href;
}
// Every registered language and page must ship its own copy: a missing file fails the
// build here instead of falling back to another language or rendering an empty page.
// The EN messages are the type reference; `npm test` keeps every language's keys equal.
export type Messages = typeof defaultMessages;
const messageFiles = import.meta.glob<Messages>('./content/*/messages.json', {
  eager: true,
  import: 'default',
});
const pageFiles = import.meta.glob<ContentPage>('./content/*/*.ts', {
  eager: true,
  import: 'default',
});
const missing = locales.flatMap((locale) => [
  ...(messageFiles[`./content/${locale}/messages.json`]
    ? []
    : [`src/content/${locale}/messages.json`]),
  ...pages
    .filter((page) => page.key !== 'home' && !pageFiles[`./content/${locale}/${page.key}.ts`])
    .map((page) => `src/content/${locale}/${page.key}.ts`),
]);
if (missing.length)
  throw new Error(`Registered languages and pages need their content:\n${missing.join('\n')}`);
// Page modules written as plain JSON skip the type check, so the FAQ shape is checked here:
// an empty question or answer would publish an empty structured-data entry.
const faqProblems = Object.entries(pageFiles).flatMap(([file, page]) => {
  const faq: unknown = page.metadata.faq;
  if (faq === undefined) return [];
  if (!Array.isArray(faq)) return [`${file}: metadata.faq must be a list`];
  return faq.flatMap((item: Partial<Record<keyof FaqItem, unknown>>, index) =>
    (['question', 'answer'] as const)
      .filter((key) => typeof item?.[key] !== 'string' || (item[key] as string).trim() === '')
      .map((key) => `${file}: metadata.faq[${index}].${key} must be non-empty text`),
  );
});
if (faqProblems.length) throw new Error(`Invalid page FAQ:\n${faqProblems.join('\n')}`);
export function messages(locale: Locale): Messages {
  return messageFiles[`./content/${locale}/messages.json`]!;
}
export function pageContent(locale: Locale, page: Exclude<PageKey, 'home'>): ContentPage {
  return pageFiles[`./content/${locale}/${page}.ts`]!;
}
export function shouldIndex(page: PageKey) {
  return (
    import.meta.env.PUBLIC_APP_ENV === 'production' &&
    pages.some((item) => item.key === page && item.sitemap)
  );
}
export function jsonLd(locale: Locale, page: PageKey, title: string, description: string) {
  const company = site.company;
  const orgId = `${site.baseUrl}#organization`;
  const websiteId = `${site.baseUrl}#website`;
  const faq = page === 'home' ? undefined : pageContent(locale, page).metadata.faq;
  const organization = company?.name?.trim()
    ? {
        '@type': 'Organization',
        '@id': orgId,
        name: company.name,
        url: site.baseUrl,
        ...(site.contact.email ? { email: site.contact.email } : {}),
        ...(site.contact.phone ? { telephone: site.contact.phone } : {}),
        ...(company.established ? { foundingDate: String(company.established) } : {}),
        ...(company.location && Object.values(company.location).some(Boolean)
          ? {
              address: {
                '@type': 'PostalAddress',
                streetAddress: company.location.address,
                addressLocality: company.location.city,
                addressCountry: company.location.country,
              },
            }
          : {}),
        ...(site.brandAssets.logo?.status === 'ready'
          ? {
              logo: new URL(site.brandAssets.logo.horizontal, site.baseUrl).href,
            }
          : {}),
        ...(Object.values(site.social).some(Boolean)
          ? { sameAs: Object.values(site.social).filter(Boolean) }
          : {}),
      }
    : undefined;
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      ...(organization ? [organization] : []),
      {
        '@type': 'WebSite',
        '@id': websiteId,
        name: site.name,
        description: messages(locale)['structured-data'].website.description,
        url: site.baseUrl,
        inLanguage: locales,
        ...(organization ? { publisher: { '@id': orgId } } : {}),
      },
      ...(page !== 'home'
        ? [
            {
              '@type': 'WebPage',
              '@id': canonical(locale, page),
              url: canonical(locale, page),
              inLanguage: locale,
              name: title,
              description,
              isPartOf: { '@id': websiteId },
              ...(organization ? { about: { '@id': orgId } } : {}),
            },
            ...(faq?.length
              ? [
                  {
                    '@type': 'FAQPage',
                    '@id': `${canonical(locale, page)}#faq`,
                    url: canonical(locale, page),
                    inLanguage: locale,
                    mainEntity: faq.map((item) => ({
                      '@type': 'Question',
                      name: item.question,
                      acceptedAnswer: { '@type': 'Answer', text: item.answer },
                    })),
                  },
                ]
              : []),
          ]
        : []),
    ],
  })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
