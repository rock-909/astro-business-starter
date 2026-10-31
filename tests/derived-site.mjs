// A derived site as owners usually configure one: contact methods, a logo, social
// links, company facts and rewritten copy. It also makes the two structural changes an
// owner makes in src/site-routes.ts: it drops Spanish (English only) and adds a generic
// About page, so a single-language site with an extra page must build and pass. Tests run against its build as well as the
// template's, so neither the layouts only derived sites render nor template wording can
// hide from CI. Sentinel domains only; nothing here is contacted.
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

export const derivedRoot = 'dist/derived-site';

const identity = {
  name: 'Northwind Valves',
  description: 'Industrial valve supplier for water utilities',
  contact: {
    email: 'sales@northwind.example.com',
    phone: '+44 20 7946 0000',
    whatsapp: '+44 7700 900123',
  },
  social: {
    linkedin: 'https://www.linkedin.com/company/northwind-valves-example',
    twitter: 'https://x.com/northwind_valves_example',
  },
  company: {
    name: 'Northwind Valves Ltd',
    established: 2004,
    location: { city: 'Leeds', country: 'GB' },
  },
  brandAssets: {
    ogImage: '/brand/share.png',
    favicon: '/brand/favicon.svg',
    logo: { status: 'ready', horizontal: '/brand/logo.svg', width: 160, height: 40 },
  },
  readiness: { ownerConfirmedIdentity: false, legalReviewed: { en: false } },
  seo: {
    titleTemplate: '%s | Northwind Valves',
    defaultTitle: 'Northwind Valves',
    defaultDescription: 'Gate, ball and check valves for water utilities.',
  },
};
const logo =
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40"><rect width="160" height="40" rx="6" fill="#123"/><text x="12" y="26" fill="#fff" font-family="sans-serif" font-size="16">Northwind</text></svg>\n';
const favicon =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#123"/></svg>\n';
// A minimal valid PNG (1x1, opaque) generated here so no template image is reused.
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(1, 0);
header.writeUInt32BE(1, 4);
header.set([8, 2, 0, 0, 0], 8);
export const minimalPng = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.from([0, 0x11, 0x22, 0x33]))),
  chunk('IEND', Buffer.alloc(0)),
]);
// The template's own brand files, left out so the fixture cannot pass on them.
const templateBrandFiles = ['opengraph-image.png', 'opengraph-image.svg', 'icon.svg'];
// The language the fixture removes; its content directory is not copied at all.
const removedLocale = 'es';
const aboutPage = {
  metadata: {
    title: 'About Northwind Valves',
    updatedAt: '2026-10-01',
    seo: {
      title: 'About us',
      description: 'Who makes Northwind valves and where they ship from.',
    },
  },
  content:
    '## Our workshop\n\nNorthwind Valves has machined valves in Leeds since 2004.\n\n## Where we ship\n\nWater utilities across the UK. [Ask for a quote](/contact).',
};
// Edits src/site-routes.ts the way an owner would, failing loudly if the registry moved.
const replaceOnce = (text, pattern, replacement) => {
  if (!pattern.test(text)) throw new Error(`Derived fixture cannot find ${pattern} in site-routes`);
  return text.replace(pattern, replacement);
};
const copy = {
  en: {
    messages: {
      'home.metadata.title': 'Northwind Valves — valves for water networks',
      'home.title': 'Valves for water networks',
      'home.eyebrow': 'Northwind Valves',
      'home.description': 'Gate, ball and check valves, shipped from Leeds.',
      'home.ruleLabel': 'Since 2004',
      'contact.panel.intro': 'Prefer to talk? Reach our Leeds sales desk.',
      'inquiry.form.statusPrefix.success': 'Sent:',
      'inquiry.form.statusPrefix.error': 'Problem:',
      'navigation.contactSales': 'Request a quote',
      'inquiry.form.fullName': 'Your name',
      'inquiry.form.submit': 'Send request',
      'cookie.rejectAll': 'Decline optional cookies',
    },
    pages: { contact: 'Talk to our sales team', privacy: 'Privacy notice', terms: 'Terms of sale' },
  },
};

const setPath = (object, path, value) => {
  const keys = path.split('.');
  const parent = keys.slice(0, -1).reduce((node, key) => node[key], object);
  if (!(keys.at(-1) in parent)) throw new Error(`Derived fixture names a missing key: ${path}`);
  parent[keys.at(-1)] = value;
};

// Recreates the fixture source tree from the current checkout; its build lands in
// `${derivedRoot}/dist`.
export function writeDerivedSite(repo = '.') {
  const root = resolve(repo, derivedRoot);
  rmSync(root, { recursive: true, force: true });
  for (const name of [
    'src',
    'public',
    'scripts',
    'astro.config.mjs',
    'wrangler.jsonc',
    'tsconfig.json',
  ])
    cpSync(resolve(repo, name), join(root, name), {
      recursive: true,
      filter: (source) =>
        source !== resolve(repo, 'src/content', removedLocale) &&
        (name !== 'public' ||
          !templateBrandFiles.some((file) => source === resolve(repo, 'public', file))),
    });
  const routes = join(root, 'src/site-routes.ts');
  let registry = readFileSync(routes, 'utf8');
  registry = replaceOnce(registry, new RegExp(`^ *${removedLocale}: \\{.*\\},\\n`, 'm'), '');
  registry = replaceOnce(
    registry,
    /^( *\{ key: 'contact'.*\n)/m,
    `$1  { key: 'about', path: '/about', kind: 'content', nav: 'main', sitemap: true },\n`,
  );
  writeFileSync(routes, registry);
  writeFileSync(
    join(root, 'src/content/en/about.ts'),
    `export default ${JSON.stringify(aboutPage, null, 2)};\n`,
  );
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', private: true }));
  symlinkSync(resolve(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
  writeFileSync(join(root, 'src/site-data.json'), JSON.stringify(identity, null, 2));
  for (const [path, bytes] of [
    [identity.brandAssets.logo.horizontal, logo],
    [identity.brandAssets.favicon, favicon],
    [identity.brandAssets.ogImage, minimalPng],
  ]) {
    const file = join(root, 'public', path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  for (const locale of readdirSync(join(root, 'src/content')).filter((name) => name in copy)) {
    const file = join(root, `src/content/${locale}/messages.json`);
    const messages = JSON.parse(readFileSync(file, 'utf8'));
    for (const [path, value] of Object.entries(copy[locale].messages))
      setPath(messages, path, value);
    writeFileSync(file, JSON.stringify(messages, null, 2));
    for (const [page, title] of Object.entries(copy[locale].pages))
      writeFileSync(
        join(root, `src/content/${locale}/${page}.ts`),
        `export default ${JSON.stringify(
          {
            metadata: {
              title,
              updatedAt: '2026-10-01',
              seo: { title, description: `${title} — ${identity.name}` },
            },
            content: `## ${title}\n\n${identity.name} owner-written ${page} copy.`,
          },
          null,
          2,
        )};\n`,
      );
  }
  return root;
}
