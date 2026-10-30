// Server-only: only the registered Action imports this module. cloudflare:workers
// deliberately cannot be imported into a browser bundle. No runtime test bypass.
import { env } from 'cloudflare:workers';
import { ActionError } from 'astro:actions';
import { ATTRIBUTION_FIELD_NAMES, isClickIdField, pickAttributionFields } from './attribution';
import { inquiryLeadSchema, type ValidatedInquiry } from './inquiry-schema';
import { generateLeadReferenceId, splitName } from './lead-utils';
import {
  ipv4ToInteger,
  integerToIpv4,
  ipv4MappedEmbeddedAddress,
  ipv6NetworkPrefix64,
} from './ip-range';

export interface InquiryEnv {
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_ALLOWED_HOSTS?: string;
  PUBLIC_SITE_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  INQUIRY_TO_EMAIL?: string;
  AIRTABLE_API_KEY?: string;
  AIRTABLE_BASE_ID?: string;
  AIRTABLE_TABLE_NAME?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  RATE_LIMIT_PEPPER?: string;
  APP_ENV?: string;
}

const settings = env as InquiryEnv;
const string = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function fail(code: 'BAD_REQUEST' | 'SERVICE_UNAVAILABLE', message: string): never {
  throw new ActionError({ code, message });
}

/** Keeps timeouts active through response-body parsing, not only until headers. */
async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 5000,
): Promise<{ ok: boolean; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Workers supports manual/follow, not redirect:'error'. Never forward tokens
    // on redirects; 3xx is non-acceptance and is classified by the caller.
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
    return { ok: response.ok, body: await response.json() };
  } finally {
    clearTimeout(timeout);
  }
}

/** Cloudflare's edge overwrites this header. Never trust x-forwarded-for. */
function clientIp(request: Request): string {
  const value = string(request.headers.get('cf-connecting-ip'));
  if (ipv4ToInteger(value) !== null || ipv6NetworkPrefix64(value) !== null) return value;
  return '0.0.0.0';
}

function rateInput(ip: string): string {
  const v4 = ipv4ToInteger(ip) ?? ipv4MappedEmbeddedAddress(ip);
  if (v4 !== null) return integerToIpv4(v4);
  const prefix = ipv6NetworkPrefix64(ip);
  return prefix === null ? ip : `ipv6:${prefix.toString(16)}`;
}

/** Same 10/minute atomic Upstash transaction and owner-approved outage policy. */
async function rateLimit(ip: string): Promise<number | undefined> {
  try {
    const pepper = string(settings.RATE_LIMIT_PEPPER);
    const url = new URL(string(settings.UPSTASH_REDIS_REST_URL));
    const token = string(settings.UPSTASH_REDIS_REST_TOKEN);
    if (
      pepper.length < 32 ||
      !token ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('configuration');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pepper),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signed = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, encoder.encode(rateInput(ip))),
    );
    const digest = Array.from(signed, (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
    const bucket = `ratelimit:inquiry:${string(settings.APP_ENV) || 'local'}:ip:${digest}`;
    const result = await fetchJson(
      `${url.href.replace(/\/$/, '')}/multi-exec`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['INCR', bucket],
          ['PEXPIRE', bucket, '60000', 'NX'],
          ['PTTL', bucket],
        ]),
      },
      2000,
    );
    const results = object(result.body) ? result.body.result : result.body;
    if (!result.ok || !Array.isArray(results) || results.length < 3) throw new Error('storage');
    const unwrap = (value: unknown) => (object(value) ? value.result : value);
    const count = unwrap(results[0]);
    const ttl = unwrap(results[2]);
    if (
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      typeof ttl !== 'number' ||
      !Number.isSafeInteger(ttl) ||
      ttl < 0
    )
      throw new Error('storage');
    return count > 10 ? Math.max(1, Math.ceil(ttl / 1000)) : undefined;
  } catch {
    // Do not log provider errors: their text may echo request data or credentials.
    console.warn('inquiry.rate_limit_unavailable');
    return undefined;
  }
}

function allowedHosts(): string[] {
  const configured = string(settings.TURNSTILE_ALLOWED_HOSTS);
  if (configured)
    return configured
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => /^[a-z0-9.-]+$/.test(host));
  try {
    return [new URL(string(settings.PUBLIC_SITE_URL)).hostname.toLowerCase()];
  } catch {
    return [];
  }
}

async function verifyTurnstile(token: unknown, ip: string): Promise<void> {
  const normalized = string(token);
  if (!normalized) fail('BAD_REQUEST', 'TURNSTILE_REQUIRED');
  if (normalized.length > 2048) fail('BAD_REQUEST', 'TURNSTILE_REJECTED');
  const secret = string(settings.TURNSTILE_SECRET_KEY);
  const hosts = allowedHosts();
  // Official always-pass keys must never turn a configured production site into a bypass.
  if (!secret || /^[123]x0{20,}[A-Z]{2}$/.test(secret) || hosts.length === 0)
    fail('SERVICE_UNAVAILABLE', 'TURNSTILE_UNAVAILABLE');
  let result: { ok: boolean; body: unknown };
  try {
    result = await fetchJson('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: normalized,
        ...(ip !== '0.0.0.0' ? { remoteip: ip } : {}),
      }),
    });
  } catch {
    fail('SERVICE_UNAVAILABLE', 'TURNSTILE_UNAVAILABLE');
  }
  if (!result.ok || !object(result.body) || typeof result.body.success !== 'boolean')
    fail('SERVICE_UNAVAILABLE', 'TURNSTILE_UNAVAILABLE');
  const body = result.body;
  const errors = body['error-codes'];
  if (
    (body.hostname !== undefined && typeof body.hostname !== 'string') ||
    (body.action !== undefined && typeof body.action !== 'string') ||
    (errors !== undefined &&
      (!Array.isArray(errors) || errors.some((error) => typeof error !== 'string')))
  )
    fail('SERVICE_UNAVAILABLE', 'TURNSTILE_UNAVAILABLE');
  if (!body.success) {
    if (
      Array.isArray(errors) &&
      errors.some((code) =>
        ['internal-error', 'invalid-input-secret', 'missing-input-secret'].includes(code),
      )
    )
      fail('SERVICE_UNAVAILABLE', 'TURNSTILE_UNAVAILABLE');
    fail('BAD_REQUEST', 'TURNSTILE_REJECTED');
  }
  if (!hosts.includes(string(body.hostname).toLowerCase())) {
    console.warn('inquiry.turnstile_rejected', { reason: 'invalid-hostname' });
    fail('BAD_REQUEST', 'TURNSTILE_REJECTED');
  }
  if (string(body.action) !== 'product_inquiry') fail('BAD_REQUEST', 'TURNSTILE_REJECTED');
}

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const spreadsheetText = (value: string): string =>
  /^[=+\-@]/.test(value.trim()) ? `'${value.trim()}` : value.trim();

async function sendEmail(lead: ValidatedInquiry): Promise<boolean> {
  try {
    const key = string(settings.RESEND_API_KEY);
    const from = string(settings.RESEND_FROM_EMAIL);
    const to = string(settings.INQUIRY_TO_EMAIL);
    if (!key || !from || !to) throw new Error('configuration');
    const fields: [string, string][] = [
      ['Reference ID', lead.referenceId],
      ['Contact name', lead.fullName],
      ['Email', lead.email],
    ];
    if (lead.locale) fields.push(['Language', lead.locale === 'es' ? 'Español' : 'English']);
    if (lead.message) fields.push(['Requirements', lead.message]);
    for (const name of ATTRIBUTION_FIELD_NAMES)
      if (lead[name])
        fields.push([name.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`), lead[name]!]);
    const text = fields.map(([label, value]) => `${label}: ${value}`).join('\n');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Website inquiry</title></head><body><h1>Website inquiry</h1>${fields.map(([label, value]) => `<h2>${escapeHtml(label)}</h2><p>${escapeHtml(value).replace(/\n/g, '<br>')}</p>`).join('')}</body></html>`;
    const result = await fetchJson('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: lead.email,
        subject: `Website inquiry ${lead.referenceId}`,
        html,
        text,
        tags: [{ name: 'type', value: 'inquiry' }],
      }),
    });
    if (result.ok && object(result.body) && string(result.body.id)) return true;
  } catch {
    /* no retry: a timeout/lost response may have already accepted the lead */
  }
  console.error('inquiry.email_acceptance_unconfirmed', { referenceId: lead.referenceId });
  return false;
}

const airtableAttribution = {
  utmSource: 'UTM Source',
  utmMedium: 'UTM Medium',
  utmCampaign: 'UTM Campaign',
  utmTerm: 'UTM Term',
  utmContent: 'UTM Content',
  landingPage: 'Landing Page',
  capturedAt: 'Captured At',
} as const;
async function saveAirtable(lead: ValidatedInquiry): Promise<boolean> {
  try {
    const key = string(settings.AIRTABLE_API_KEY);
    const base = string(settings.AIRTABLE_BASE_ID);
    const table = string(settings.AIRTABLE_TABLE_NAME);
    if (!key || !base || !table) throw new Error('configuration');
    const { firstName, lastName } = splitName(lead.fullName);
    const fields: Record<string, string> = {
      Email: lead.email,
      'Submitted At': new Date().toISOString(),
      Status: 'New',
      Source: 'Website Inquiry',
      'Reference ID': lead.referenceId,
      'First Name': spreadsheetText(firstName),
      'Last Name': spreadsheetText(lastName),
      Message: spreadsheetText(lead.message ? `Requirements: ${lead.message}` : 'General inquiry'),
    };
    if (lead.message) fields.Requirements = spreadsheetText(lead.message);
    for (const name of ATTRIBUTION_FIELD_NAMES)
      if (!isClickIdField(name) && lead[name])
        fields[airtableAttribution[name]] = spreadsheetText(lead[name]!);
    const result = await fetchJson(
      `https://api.airtable.com/v0/${encodeURIComponent(base)}/${encodeURIComponent(table)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields }] }),
      },
    );
    const records = object(result.body) ? result.body.records : undefined;
    if (result.ok && Array.isArray(records) && object(records[0]) && string(records[0].id))
      return true;
  } catch {
    /* Independent from email; never log submitted fields or raw provider errors. */
  }
  console.error('inquiry.airtable_acceptance_unconfirmed', { referenceId: lead.referenceId });
  return false;
}

export async function submitInquiry(
  input: Record<string, unknown>,
  request: Request,
  locals: App.Locals,
): Promise<{ success: true; referenceId: string }> {
  const ip = clientIp(request);
  const retryAfter = await rateLimit(ip);
  if (retryAfter !== undefined) {
    locals.inquiryRetryAfter = retryAfter;
    throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'RATE_LIMIT_EXCEEDED' });
  }
  if (typeof input.website === 'string' && input.website.trim()) {
    const referenceId = generateLeadReferenceId();
    console.warn('inquiry.honeypot', { referenceId });
    return { success: true, referenceId };
  }
  const rest = { ...input };
  for (const field of ATTRIBUTION_FIELD_NAMES) delete rest[field];
  const parsed = inquiryLeadSchema.safeParse({
    ...rest,
    ...pickAttributionFields(input),
    type: 'inquiry',
  });
  if (!parsed.success) {
    // ActionInputError is not a public Astro export. Use its supported ActionError
    // message channel for a small PII-free field list instead of private wire APIs.
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')).filter(Boolean)),
    ];
    throw new ActionError({
      code: 'BAD_REQUEST',
      message: JSON.stringify({ code: 'INQUIRY_VALIDATION_FAILED', fields }),
    });
  }
  await verifyTurnstile(input.turnstileToken, ip);
  const lead: ValidatedInquiry = { ...parsed.data, referenceId: generateLeadReferenceId() };
  const [emailAccepted, recordAccepted] = await Promise.all([sendEmail(lead), saveAirtable(lead)]);
  if (!emailAccepted && !recordAccepted) fail('SERVICE_UNAVAILABLE', 'DELIVERY_UNCONFIRMED');
  console.info('inquiry.accepted', {
    referenceId: lead.referenceId,
    emailAccepted,
    recordAccepted,
  });
  return { success: true, referenceId: lead.referenceId };
}
