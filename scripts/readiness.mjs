import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { loadEnv } from 'vite';
import { unstable_readConfig } from 'wrangler';
import { parseAllowedHosts } from '../src/lib/inquiry-hosts.ts';

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
// Starter wording that must not reach an indexable derived site (EN and ES).
const templateCopy =
  /astro business starter|non-production|inquiry site|sitio de consultas|\ben \/ es\b|no destinado a producción|sentinel|reference (?:site|contact page)|site reference|(?:sitio|página)(?: de contacto)? de referencia|starting point|punto de partida|should replace|debe sustituir|must be replaced|not ready to receive|no está listo para recibir/i;
// Only rendered in states readiness already blocks: experiment builds and a blank mailbox.
const templateOnlyKeys = /^(?:experiment\.|contact\.panel\.unconfiguredMailbox$)/;
// SHA-256 of the starter share images (PNG and its SVG source), whose artwork reads
// "Non-production reference site"; a derived site must ship its own.
const templateShareImages = new Set([
  'ce982e42c3a15c1ef92ce508adb91a070363bb5013ec42c3bc7b8c189bb51d8b',
  'b496fcbf531621afff41352876c0feab803f41630455a5e8417b2447cb8c0012',
]);
const templateWorkerName = 'astro-business-starter';
const wranglerConfig = (root) =>
  unstable_readConfig(
    { config: fileURLToPath(new URL('wrangler.jsonc', root)) },
    { hideWarnings: true },
  );
const stringLeaves = (value, path = '') =>
  typeof value === 'string'
    ? [[path, value]]
    : Object.entries(value ?? {}).flatMap(([key, child]) =>
        stringLeaves(child, path ? `${path}.${key}` : key),
      );
const senderMailbox = (value) =>
  typeof value === 'string' &&
  !/[\r\n]/.test(value) &&
  mailbox(value.match(/^[^<>]+<([^<>]+)>$/)?.[1]?.trim() || value);

// The one env both launch gates check: wrangler.jsonc vars (what deploys as plain vars),
// overridden by the mode's .env files, overridden by the shell. PUBLIC_* values come only
// from the shell and .env files, like the values the build renders. .dev.vars is local
// development input and never counts, although the adapter copies it into process.env.
export function launchEnv(mode, shell = process.env, root = new URL('../', import.meta.url)) {
  const vars = Object.entries(wranglerConfig(root).vars ?? {})
    .filter(([key]) => !key.startsWith('PUBLIC_'))
    .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]);
  // Vite's loadEnv also reads process.env; give it the shell snapshot instead.
  const current = process.env;
  process.env = { ...shell };
  try {
    return { ...Object.fromEntries(vars), ...loadEnv(mode, fileURLToPath(root), '') };
  } finally {
    process.env = current;
  }
}

export function readinessIssues(env = process.env, data, root = new URL('../', import.meta.url)) {
  const read = (path) => readFileSync(new URL(path, root), 'utf8');
  data ??= JSON.parse(read('src/site-data.json'));
  const issues = [];
  if (wranglerConfig(root).name === templateWorkerName)
    issues.push(
      `wrangler.jsonc name must be this site's own Worker name, not ${templateWorkerName}`,
    );
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
    // Same parser as the Worker, so a value that passes here is read the same way there.
    const { hosts, invalid } = parseAllowedHosts(env.TURNSTILE_ALLOWED_HOSTS);
    if (invalid || !hosts.length)
      issues.push(
        'TURNSTILE_ALLOWED_HOSTS must list hostnames (or https:// URLs) separated by commas',
      );
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
  for (const [path, value] of [
    ['name', data.name],
    ['description', data.description],
    ['seo.titleTemplate', data.seo?.titleTemplate],
    ['seo.defaultTitle', data.seo?.defaultTitle],
    ['seo.defaultDescription', data.seo?.defaultDescription],
  ])
    if (templateCopy.test(value || '')) issues.push(`${path} still contains template copy`);
  // A valid path format does not mean the file ships: a wrong one breaks the header,
  // share cards and the JSON-LD logo.
  const publicRoot = new URL('public/', root);
  for (const [path, value] of [
    ['brandAssets.ogImage', data.brandAssets?.ogImage],
    ['brandAssets.favicon', data.brandAssets?.favicon],
    ['brandAssets.logo.horizontal', data.brandAssets?.logo?.horizontal],
  ]) {
    if (typeof value !== 'string' || !value.startsWith('/')) continue;
    const file = new URL(`.${new URL(value, 'https://site.invalid').pathname}`, publicRoot);
    if (
      !file.href.startsWith(publicRoot.href) ||
      !statSync(file, { throwIfNoEntry: false })?.isFile()
    )
      issues.push(`${path} ${value} does not exist under public/`);
    else if (
      path === 'brandAssets.ogImage' &&
      templateShareImages.has(createHash('sha256').update(readFileSync(file)).digest('hex'))
    )
      issues.push(`${path} ${value} is still the template share image`);
  }
  if (data.company?.established > new Date().getFullYear())
    issues.push('company.established must not be later than the current year');
  if (!data.contact?.email || sentinel.test(data.contact.email))
    issues.push('A real owner-confirmed public contact email is required');
  if (!data.readiness?.legalReviewed?.en || !data.readiness?.legalReviewed?.es)
    issues.push('Both legal locales must be reviewed and approved');
  for (const locale of ['en', 'es']) {
    for (const [path, value] of stringLeaves(
      JSON.parse(read(`src/content/${locale}/messages.json`)),
    ))
      if (!templateOnlyKeys.test(path) && templateCopy.test(value))
        issues.push(`${locale}/messages ${path} still contains template copy`);
    const contact = createRequire(import.meta.url)(
      fileURLToPath(new URL(`src/content/${locale}/contact.ts`, root)),
    ).default;
    for (const [path, value] of stringLeaves(contact))
      if (templateCopy.test(value))
        issues.push(`${locale}/contact ${path} still contains template copy`);
    for (const page of ['privacy', 'terms']) {
      const text = read(`src/content/${locale}/${page}.ts`);
      if (
        /placeholder|to be completed|incomplete|por completar|incomplet[ao]|marcador de posición/i.test(
          text,
        )
      )
        issues.push(`${locale}/${page} still contains template legal text`);
    }
  }
  return [...new Set(issues)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const issues = readinessIssues(launchEnv('production'));
  if (issues.length) {
    console.error('NOT LAUNCH READY\n' + issues.map((issue) => `- ${issue}`).join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      'Configuration prerequisites pass. This is NOT proof of live provider delivery, legal sufficiency, or deployment.',
    );
}
