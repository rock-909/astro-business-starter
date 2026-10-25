import { pages, locales, canonical, pageContent } from '../site';
export const prerender = true;
const xml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' })[char]!);
export function GET() {
  const entries = locales.flatMap((locale) => pages.filter((page) => page.sitemap).map((page) => {
    const alternates = [...locales.map((language) => `<xhtml:link rel="alternate" hreflang="${language}" href="${xml(canonical(language, page.key))}"/>`), `<xhtml:link rel="alternate" hreflang="x-default" href="${xml(canonical('en', page.key))}"/>`].join('');
    const updated = page.key === 'contact' ? `<lastmod>${pageContent(locale, 'contact').metadata.updatedAt}</lastmod>` : '';
    return `<url><loc>${xml(canonical(locale, page.key))}</loc>${updated}${alternates}</url>`;
  }));
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join('')}</urlset>`, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
