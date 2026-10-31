import { site, pages, locales, localeTable, canonical, messages, pageContent } from '../site';
export const prerender = true;
export function GET() {
  const lines = [`# ${site.name}`, '', `> ${site.description}`, ''];
  for (const locale of locales) {
    lines.push(`## ${localeTable[locale].name}`, '');
    for (const page of pages.filter((page) => page.sitemap)) {
      const content =
        page.key === 'home'
          ? {
              title: messages(locale).home.metadata.title || site.seo.defaultTitle,
              description: messages(locale).home.metadata.description,
            }
          : pageContent(locale, page.key).metadata.seo;
      lines.push(`- [${content.title}](${canonical(locale, page.key)}): ${content.description}`);
    }
    lines.push('');
  }
  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
