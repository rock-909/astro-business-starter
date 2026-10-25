/** Site identity and route registry adapted from the owner-provided reference; no supplier facts are invented. */
import identity from "./site-data.json";
import { assertValidSiteConfig } from "./site-schema";
import en from "./content/en/messages.json";
import es from "./content/es/messages.json";
import enContact from "./content/en/contact";
import esContact from "./content/es/contact";
import enPrivacy from "./content/en/privacy";
import esPrivacy from "./content/es/privacy";
import enTerms from "./content/en/terms";
import esTerms from "./content/es/terms";

export const locales = ["en", "es"] as const;
export type Locale = (typeof locales)[number];
export const pages = [
  { key: "home", path: "/", sitemap: true },
  { key: "contact", path: "/contact", sitemap: true },
  { key: "privacy", path: "/privacy", sitemap: false },
  { key: "terms", path: "/terms", sitemap: false },
] as const;
export type PageKey = (typeof pages)[number]["key"];
export interface ContentPage {
  metadata: {
    title: string;
    updatedAt: string;
    seo: { title: string; description: string };
  };
  content: string;
}
export const site = {
  ...assertValidSiteConfig(identity),
  baseUrl: (
    import.meta.env.PUBLIC_SITE_URL || "https://example.invalid"
  ).replace(/\/+$/, ""),
};
// Validate the actual public identity at build time; launch readiness is a separate gate.
const base = new URL(site.baseUrl);
if (
  !["https:", "http:"].includes(base.protocol) ||
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  base.pathname !== "/"
)
  throw new Error("PUBLIC_SITE_URL must be an http(s) origin");
export function pathFor(locale: Locale, page: PageKey): string {
  const path = pages.find((item) => item.key === page)!.path;
  return locale === "en" ? path : `/es${path === "/" ? "" : path}`;
}
export function canonical(locale: Locale, page: PageKey): string {
  return new URL(pathFor(locale, page), site.baseUrl).href;
}
export function messages(locale: Locale) {
  return locale === "es" ? es : en;
}
export function pageContent(
  locale: Locale,
  page: Exclude<PageKey, "home">,
): ContentPage {
  return {
    en: { contact: enContact, privacy: enPrivacy, terms: enTerms },
    es: { contact: esContact, privacy: esPrivacy, terms: esTerms },
  }[locale][page];
}
export function shouldIndex(page: PageKey) {
  return (
    import.meta.env.PUBLIC_APP_ENV === "production" &&
    pages.some((item) => item.key === page && item.sitemap)
  );
}
export function jsonLd(
  locale: Locale,
  page: PageKey,
  title: string,
  description: string,
) {
  const company = site.company;
  const orgId = `${site.baseUrl}#organization`;
  const websiteId = `${site.baseUrl}#website`;
  const organization = company?.name?.trim()
    ? {
        "@type": "Organization",
        "@id": orgId,
        name: company.name,
        url: site.baseUrl,
        ...(site.contact.email ? { email: site.contact.email } : {}),
        ...(site.contact.phone ? { telephone: site.contact.phone } : {}),
        ...(company.established
          ? { foundingDate: String(company.established) }
          : {}),
        ...(company.location && Object.values(company.location).some(Boolean)
          ? {
              address: {
                "@type": "PostalAddress",
                streetAddress: company.location.address,
                addressLocality: company.location.city,
                addressCountry: company.location.country,
              },
            }
          : {}),
        ...(site.brandAssets.logo?.status === "ready"
          ? {
              logo: new URL(site.brandAssets.logo.horizontal, site.baseUrl)
                .href,
            }
          : {}),
        ...(Object.values(site.social).some(Boolean)
          ? { sameAs: Object.values(site.social).filter(Boolean) }
          : {}),
      }
    : undefined;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      ...(organization ? [organization] : []),
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: site.name,
        description: messages(locale)["structured-data"].website.description,
        url: site.baseUrl,
        inLanguage: locales,
        ...(organization ? { publisher: { "@id": orgId } } : {}),
      },
      ...(page !== "home"
        ? [
            {
              "@type": "WebPage",
              "@id": canonical(locale, page),
              url: canonical(locale, page),
              inLanguage: locale,
              name: title,
              description,
              isPartOf: { "@id": websiteId },
              ...(organization ? { about: { "@id": orgId } } : {}),
            },
          ]
        : []),
    ],
  })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
