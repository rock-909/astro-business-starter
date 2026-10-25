import { site, pages, locales, canonical, messages, pageContent } from '../site';
export const prerender = true;
export function GET() {
  const lines = [`# ${site.name}`, '', `> ${site.description}`, ''];
  for (const locale of locales) {
    lines.push(`## ${locale === 'en' ? 'English' : 'Español'}`, '');
    for (const page of pages.filter((page) => page.sitemap)) {
      const content = page.key === 'home' ? { title: site.name, description: messages(locale).home.metadata.description } : pageContent(locale, page.key).metadata.seo;
      lines.push(`- [${content.title}](${canonical(locale, page.key)}): ${content.description}`);
    }
    lines.push('');
  }
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
