import { ActionError } from 'astro:actions';

/** No-Origin non-browser callers still pass every validation and anti-abuse gate. */
export function assertInquiryAdmission(request: Request): void {
  if (request.method !== 'POST') {
    throw new ActionError({ code: 'METHOD_NOT_ALLOWED', message: 'INVALID_REQUEST' });
  }
  const mediaType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ActionError({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'UNSUPPORTED_MEDIA_TYPE' });
  }
  const origin = request.headers.get('origin');
  if (origin === null) return;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    if (
      (source.protocol === 'https:' || source.protocol === 'http:') &&
      source.origin === target.origin &&
      source.href === `${source.origin}/`
    )
      return;
  } catch {
    /* malformed origins are rejected below */
  }
  throw new ActionError({ code: 'FORBIDDEN', message: 'INVALID_REQUEST' });
}

/**
 * Astro 7.4's native parser streams its limit only when Content-Length is absent.
 * For declared lengths it trusts the header, so independently count actual bytes
 * before the framework parses. The original tee retains at most the bounded body.
 */
export async function boundDeclaredInquiryBody(request: Request): Promise<void> {
  const advertised = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (!Number.isFinite(advertised) || advertised > 65536 || !request.body) return;
  const reader = request.clone().body!.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      received += value.byteLength;
      if (received > 65536)
        throw new ActionError({ code: 'CONTENT_TOO_LARGE', message: 'BODY_TOO_LARGE' });
    }
  } catch (error) {
    // Awaiting just one tee's cancellation can deadlock until its sibling reads.
    void reader.cancel().catch(() => {});
    void request.body.cancel().catch(() => {});
    if (error instanceof ActionError) throw error;
    throw new ActionError({ code: 'BAD_REQUEST', message: 'INVALID_REQUEST' });
  } finally {
    reader.releaseLock();
  }
}
