import { ActionError, getActionContext } from 'astro:actions';
import { defineMiddleware } from 'astro:middleware';
import { assertInquiryAdmission, boundDeclaredInquiryBody } from './lib/admission';
import { securityHeaders } from './security-headers';

function secure(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) secured.headers.set(name, value);
  return secured;
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next();
  const { action, serializeActionResult } = getActionContext(context);
  if (!action) return secure(await next());
  // Covers both /_actions/inquiry RPC and native ?_action=inquiry invocations.
  // Native limit covers absent Content-Length; supplement declared-length bodies.
  try {
    assertInquiryAdmission(context.request);
    await boundDeclaredInquiryBody(context.request);
  }
  catch (error) {
    if (!(error instanceof ActionError)) throw error;
    const serialized = serializeActionResult({ data: undefined, error });
    if (serialized.type !== 'error') throw new Error('Unexpected action serialization');
    return secure(new Response(serialized.body, { status: serialized.status, headers: { 'Content-Type': serialized.contentType, 'Cache-Control': 'no-store' } }));
  }
  const response = secure(await next());
  response.headers.set('Cache-Control', 'no-store');
  if (context.locals.inquiryRetryAfter !== undefined) response.headers.set('Retry-After', String(context.locals.inquiryRetryAfter));
  return response;
});
