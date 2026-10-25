import { site } from '../site';
export const prerender = true;
export function GET() {
  const lines = ['User-agent: *', ...(import.meta.env.PUBLIC_APP_ENV === 'production'
    ? ['Allow: /', 'Disallow: /api/', 'Disallow: /_actions/'] : ['Disallow: /']), `Sitemap: ${site.baseUrl}/sitemap.xml`, ''];
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
