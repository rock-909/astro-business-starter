export const prerender = false;
export function GET() {
  return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
}
