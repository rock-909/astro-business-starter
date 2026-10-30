import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { loadEnv } from 'vite';

const publicHostname = (host) =>
  !isIP(host) &&
  host.includes('.') &&
  !/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(host) &&
  !/^example\.(?:com|org|net)$/.test(host) &&
  host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
const publicOrigin = (value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.port &&
      publicHostname(url.hostname)
    );
  } catch {
    return false;
  }
};
const mailbox = (value) =>
  typeof value === 'string' &&
  value.length <= 254 &&
  /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) &&
  publicHostname(value.split('@')[1]);
const senderMailbox = (value) =>
  typeof value === 'string' &&
  !/[\r\n]/.test(value) &&
  mailbox(value.match(/^[^<>]+<([^<>]+)>$/)?.[1]?.trim() || value);

export function readinessIssues(
  env = process.env,
  data = JSON.parse(readFileSync(new URL('../src/site-data.json', import.meta.url), 'utf8')),
) {
  const issues = [];
  const required = [
    'PUBLIC_SITE_URL',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'INQUIRY_TO_EMAIL',
    'AIRTABLE_API_KEY',
    'AIRTABLE_BASE_ID',
    'AIRTABLE_TABLE_NAME',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'RATE_LIMIT_PEPPER',
  ];
  for (const key of required) if (!env[key]?.trim()) issues.push(`${key} is required`);
  const sentinel =
    /example\.(?:invalid|com)|localhost|127\.0\.0\.1|fixture|test[-_ ]|placeholder|to be completed/i;
  for (const key of required)
    if (sentinel.test(env[key] || ''))
      issues.push(`${key} contains an experiment/placeholder value`);
  if (!publicOrigin(env.PUBLIC_SITE_URL))
    issues.push('PUBLIC_SITE_URL must be a public HTTPS origin, not a local/IP/sentinel host');
  if (!publicOrigin(env.UPSTASH_REDIS_REST_URL))
    issues.push('UPSTASH_REDIS_REST_URL must be a public HTTPS origin');
  if (!senderMailbox(env.RESEND_FROM_EMAIL))
    issues.push(
      'RESEND_FROM_EMAIL must be a valid public email address (optionally Name <address>)',
    );
  if (!mailbox(env.INQUIRY_TO_EMAIL))
    issues.push('INQUIRY_TO_EMAIL must be a valid public email address');
  if (!mailbox(data.contact?.email))
    issues.push('Public contact.email must be a valid public email address');
  if (!/^app[A-Za-z0-9]{10,}$/.test(env.AIRTABLE_BASE_ID || ''))
    issues.push('AIRTABLE_BASE_ID must be a valid Airtable app identifier');
  if (env.TURNSTILE_ALLOWED_HOSTS) {
    const hosts = env.TURNSTILE_ALLOWED_HOSTS.split(',').map((host) => host.trim().toLowerCase());
    let siteHost = '';
    try {
      siteHost = new URL(env.PUBLIC_SITE_URL).hostname;
    } catch {
      /* Reported above. */
    }
    if (!hosts.every(publicHostname) || !hosts.includes(siteHost))
      issues.push(
        'TURNSTILE_ALLOWED_HOSTS must include the public site hostname and contain only public hostnames',
      );
  }
  if (
    /^[123]x0{20,}[A-Z]{2}$/.test(env.TURNSTILE_SECRET_KEY || '') ||
    /^[123]x0{12,}/.test(env.PUBLIC_TURNSTILE_SITE_KEY || '')
  )
    issues.push('Turnstile test keys are not production credentials');
  if ((env.RATE_LIMIT_PEPPER || '').length < 32)
    issues.push('RATE_LIMIT_PEPPER must contain at least 32 characters');
  for (const [path, value] of [
    ['name', data.name],
    ['description', data.description],
    ['seo.titleTemplate', data.seo?.titleTemplate],
    ['seo.defaultTitle', data.seo?.defaultTitle],
    ['seo.defaultDescription', data.seo?.defaultDescription],
  ]) {
    if (typeof value !== 'string' || !value.trim())
      issues.push(`${path} must contain nonblank text`);
  }
  if (
    !data.readiness?.ownerConfirmedIdentity ||
    /template|reference|placeholder/i.test(`${data.name} ${data.description}`)
  )
    issues.push('The owner must confirm real business identity and replace template identity');
  if (!data.contact?.email || sentinel.test(data.contact.email))
    issues.push('A real owner-confirmed public contact email is required');
  if (!data.readiness?.legalReviewed?.en || !data.readiness?.legalReviewed?.es)
    issues.push('Both legal locales must be reviewed and approved');
  for (const locale of ['en', 'es'])
    for (const page of ['privacy', 'terms']) {
      const text = readFileSync(
        new URL(`../src/content/${locale}/${page}.ts`, import.meta.url),
        'utf8',
      );
      if (
        /placeholder|to be completed|incomplete|por completar|incomplet[ao]|marcador de posición/i.test(
          text,
        )
      )
        issues.push(`${locale}/${page} still contains template legal text`);
    }
  return [...new Set(issues)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const issues = readinessIssues(loadEnv('production', process.cwd(), ''));
  if (issues.length) {
    console.error('NOT LAUNCH READY\n' + issues.map((issue) => `- ${issue}`).join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      'Configuration prerequisites pass. This is NOT proof of live provider delivery, legal sufficiency, or deployment.',
    );
}
