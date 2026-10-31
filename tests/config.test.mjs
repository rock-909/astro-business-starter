import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { assertValidSiteConfig } from '../src/site-schema.ts';
import { locales } from '../src/site-routes.ts';
import {
  launchEnv,
  readinessIssues,
  templateCopy,
  templateOnlyKeys,
} from '../scripts/readiness.mjs';
import { startHarness } from './harness.mjs';
import { derivedRoot, minimalPng } from './derived-site.mjs';
import { loadSite } from './site-config.mjs';

const identity = JSON.parse(
  readFileSync(new URL('../src/site-data.json', import.meta.url), 'utf8'),
);
// Owner-rewritten copy for every template phrase a derived site must replace before launch,
// plus its own share image and Worker name.
const launchCopy = 'Owner approved copy';
const contentLocales = (root) => readdirSync(join(root, 'src/content'));
const rewriteTemplateLeaves = (node, path = '') => {
  for (const [key, value] of Object.entries(node)) {
    const leaf = path ? `${path}.${key}` : key;
    if (typeof value !== 'string') rewriteTemplateLeaves(value, leaf);
    else if (!templateOnlyKeys.test(leaf) && templateCopy.test(value)) node[key] = launchCopy;
  }
};
const writePage = (root, locale, page, text, comment = '', seoTitle = page) =>
  writeFileSync(
    join(root, `src/content/${locale}/${page}.ts`),
    `${comment}export default ${JSON.stringify({
      metadata: {
        title: page,
        updatedAt: '2026-10-25',
        seo: { title: seoTitle, description: text },
      },
      content: text,
    })};`,
  );
// Works on whatever copy the checkout has, template or derived. Writes the launch
// identity's own brand files too, so nothing rests on the checkout's public/ files.
function writeLaunchCopy(root) {
  for (const path of Object.values(launchBrandAssets)) {
    const file = join(root, 'public', path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, minimalPng);
  }
  // The site's own Worker name, whatever the checkout ships.
  const wrangler = join(root, 'wrangler.jsonc');
  writeFileSync(
    wrangler,
    readFileSync(wrangler, 'utf8').replace(/"name": "[^"]*"/, '"name": "configured-business"'),
  );
  for (const locale of contentLocales(root)) {
    const file = join(root, `src/content/${locale}/messages.json`);
    const messages = JSON.parse(readFileSync(file, 'utf8'));
    rewriteTemplateLeaves(messages);
    writeFileSync(file, JSON.stringify(messages));
    // A leftover comment naming the starter is not page copy.
    writePage(root, locale, 'contact', launchCopy, '// Replaced reference site copy\n');
    for (const page of ['privacy', 'terms'])
      writePage(root, locale, page, 'Owner approved legal copy');
  }
}
// A disposable copy of the checkout's content and public files with launch-ready copy.
function launchFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'astro-copy-'));
  cpSync(resolve('src/content'), join(fixture, 'src/content'), { recursive: true });
  cpSync(resolve('public'), join(fixture, 'public'), { recursive: true });
  cpSync(resolve('wrangler.jsonc'), join(fixture, 'wrangler.jsonc'));
  writeLaunchCopy(fixture);
  return fixture;
}
// A derived site may ship a raster favicon instead of the template SVG.
const launchBrandAssets = { ogImage: '/brand/share.png', favicon: '/brand/icon.png' };
const launchIdentity = {
  ...identity,
  brandAssets: launchBrandAssets,
  name: 'Configured business',
  description: 'Owner confirmed business identity',
  seo: {
    titleTemplate: '%s | Configured business',
    defaultTitle: 'Configured business',
    defaultDescription: launchCopy,
  },
  company: { established: 2004 },
  contact: { email: 'sales@supplier.co.uk' },
  readiness: {
    ownerConfirmedIdentity: true,
    legalReviewed: Object.fromEntries(locales.map((locale) => [locale, true])),
  },
};
const htmlEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Built HTML text or attribute value with HTML character references undone.
const decodeHtml = (text) =>
  text.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (entity, decimal, hex, name) =>
    decimal
      ? String.fromCodePoint(Number(decimal))
      : hex
        ? String.fromCodePoint(parseInt(hex, 16))
        : (htmlEntities[name] ?? entity),
  );
// The favicon href a built page declares, with HTML attribute escaping undone.
const faviconHref = (html) => {
  const href = html.match(/<link rel="icon" href="([^"]*)"/)?.[1];
  return href === undefined ? href : decodeHtml(href);
};
// Inert syntax-only prerequisites; no request is made to these hosts/providers.
const productionPrerequisites = {
  PUBLIC_APP_ENV: 'production',
  PUBLIC_SITE_URL: 'https://supplier.co.uk',
  PUBLIC_TURNSTILE_SITE_KEY: 'opaque-public-key',
  TURNSTILE_SECRET_KEY: 'opaque-verification-value',
  RESEND_API_KEY: 'opaque-email-value',
  RESEND_FROM_EMAIL: 'sales@supplier.co.uk',
  INQUIRY_TO_EMAIL: 'sales@supplier.co.uk',
  AIRTABLE_API_KEY: 'opaque-crm-value',
  AIRTABLE_BASE_ID: 'app01234567890',
  AIRTABLE_TABLE_NAME: 'Leads',
  UPSTASH_REDIS_REST_URL: 'https://redis.supplier.co.uk',
  UPSTASH_REDIS_REST_TOKEN: 'opaque-rate-value',
  RATE_LIMIT_PEPPER: 'abcdefghijklmnopqrstuvwxyz0123456789',
};

test('every registered language defines the same message keys with the same value shapes', () => {
  // Copy is typed from EN only, so a missing key in another language would pass `npm run check`.
  const shapes = (value, path = '') =>
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) => shapes(child, `${path}/${key}`))
      : [`${path}: ${typeof value}`];
  const [reference, ...others] = locales.map((locale) => ({
    locale,
    keys: shapes(
      JSON.parse(
        readFileSync(new URL(`../src/content/${locale}/messages.json`, import.meta.url), 'utf8'),
      ),
    ).sort(),
  }));
  for (const { locale, keys } of others) assert.deepEqual(keys, reference.keys, locale);
});

test('legal approval is recorded once per registered language, no more and no fewer', () => {
  const approved = (legalReviewed) => ({
    ...identity,
    readiness: { ownerConfirmedIdentity: true, legalReviewed },
  });
  const all = Object.fromEntries(locales.map((locale) => [locale, true]));
  assert.deepEqual(assertValidSiteConfig(approved(all)).readiness.legalReviewed, all);
  // A language left over after it was removed, or one never approved, is a config error.
  assert.throws(() => assertValidSiteConfig(approved({ ...all, xx: true })), /"xx"/);
  for (const locale of locales) {
    const { [locale]: _, ...rest } = all;
    assert.throws(
      () => assertValidSiteConfig(approved(rest)),
      new RegExp(`legalReviewed\\.${locale}`),
    );
    const issues = readinessIssues({}, approved({ ...all, [locale]: false }));
    assert.deepEqual(
      issues.filter((issue) => issue.includes('legal pages must')),
      [`The ${locale} legal pages must be reviewed and approved`],
    );
  }
});

test('readiness names a registered page or language whose content is missing instead of crashing', () => {
  const fixture = launchFixture();
  try {
    const [locale] = locales;
    rmSync(join(fixture, `src/content/${locale}/terms.ts`));
    rmSync(join(fixture, `src/content/${locale}/messages.json`));
    const issues = readinessIssues(
      productionPrerequisites,
      launchIdentity,
      pathToFileURL(`${fixture}/`),
    );
    assert.deepEqual(issues, [
      `src/content/${locale}/messages.json is missing`,
      `src/content/${locale}/terms.ts is missing`,
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('optional company facts are validated and consumed without requiring an organization', async () => {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const { site, jsonLd } = await server.ssrLoadModule('/src/site.ts');
    for (const company of [undefined, {}, { established: 2000 }, { name: '' }]) {
      assertValidSiteConfig({ ...identity, company });
      site.company = company;
      const graph = JSON.parse(jsonLd('en', 'home', 'Title', 'Description'))['@graph'];
      assert.ok(!graph.some((item) => item['@type'] === 'Organization'));
    }
    const company = {
      name: 'Configured business',
      established: 2000,
      location: { address: '1 Main Street', city: 'Madrid', country: 'ES' },
    };
    const parsed = assertValidSiteConfig({
      ...identity,
      company,
      unknown: 'discard',
    });
    assert.deepEqual(parsed.company, company);
    assert.deepEqual(parsed.readiness, identity.readiness);
    assert.equal(parsed.unknown, undefined);
    site.company = parsed.company;
    const organization = JSON.parse(jsonLd('en', 'home', 'Title', 'Description'))['@graph'].find(
      (item) => item['@type'] === 'Organization',
    );
    assert.equal(organization.name, company.name);
    assert.equal(organization.address.addressLocality, 'Madrid');
    assert.equal(organization.foundingDate, '2000');
  } finally {
    await server.close();
  }
});

test('jsonLd stays inert inside a script element and round-trips hostile names', async () => {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const { site, jsonLd } = await server.ssrLoadModule('/src/site.ts');
    const hostile = `A&B "Co" 'Ltd' <b>x</b> </script><script>alert(1)</script>\u2028`;
    site.name = hostile;
    site.company = { name: hostile };
    const output = jsonLd('en', 'contact', hostile, hostile);
    for (const raw of ['<', '>', '&', '\u2028']) {
      assert.ok(!output.includes(raw), `raw ${JSON.stringify(raw)} in JSON-LD`);
    }
    const graph = JSON.parse(output)['@graph'];
    const byType = (type) => graph.find((item) => item['@type'] === type);
    assert.equal(byType('Organization').name, hostile);
    assert.equal(byType('WebSite').name, hostile);
    assert.equal(byType('WebPage').name, hostile);
    assert.equal(byType('WebPage').description, hostile);
  } finally {
    await server.close();
  }
});

test('company consumer fields reject invalid types at the configuration boundary', () => {
  for (const [company, path] of [
    [{ name: 123 }, 'company.name'],
    [{ location: 'Madrid' }, 'company.location'],
    [{ location: { address: 42 } }, 'company.location.address'],
    [{ location: { city: 42 } }, 'company.location.city'],
    [{ location: { country: 42 } }, 'company.location.country'],
  ]) {
    assert.throws(
      () => assertValidSiteConfig({ ...identity, company }),
      (error) => error.message.includes(path),
      path,
    );
  }
});

test('readiness requires nonblank identity and SEO text even after owner confirmation', () => {
  for (const path of [
    'name',
    'description',
    'seo.titleTemplate',
    'seo.defaultTitle',
    'seo.defaultDescription',
  ]) {
    for (const blank of ['', '   ']) {
      const configured = structuredClone(identity);
      configured.readiness.ownerConfirmedIdentity = true;
      const [parent, key] = path.split('.');
      if (key) configured[parent][key] = blank;
      else configured[parent] = blank;
      assert.ok(
        readinessIssues({}, configured).includes(`${path} must contain nonblank text`),
        `${path}: ${JSON.stringify(blank)}`,
      );
    }
  }
});

test('readiness rejects template copy wherever it renders and accepts owner-rewritten copy', () => {
  const ready = launchFixture();
  try {
    assert.deepEqual(
      readinessIssues(productionPrerequisites, launchIdentity, pathToFileURL(`${ready}/`)),
      [],
    );
  } finally {
    rmSync(ready, { recursive: true, force: true });
  }
  // Frozen template wording, so the check does not depend on what this checkout ships.
  const starter = 'A non-production inquiry reference site that must be replaced before launch.';
  const starterTitle = { en: 'Inquiry site', es: 'Sitio de consultas' };
  const identityIssues = readinessIssues(productionPrerequisites, {
    ...launchIdentity,
    seo: {
      titleTemplate: '%s | Astro Business Starter',
      defaultTitle: 'Configured business',
      defaultDescription: starter,
    },
  });
  for (const issue of [
    'seo.titleTemplate still contains template copy',
    'seo.defaultDescription still contains template copy',
  ])
    assert.ok(identityIssues.includes(issue), issue);

  for (const locale of contentLocales('.')) {
    // readiness loads contact modules through require(), so each case gets a fresh copy.
    const fixture = launchFixture();
    try {
      const file = join(fixture, `src/content/${locale}/messages.json`);
      const messages = JSON.parse(readFileSync(file, 'utf8'));
      messages.home.title = starterTitle[locale] ?? starterTitle.en;
      messages.home.ruleLabel = 'EN / ES';
      messages.home.description = starter;
      messages.home.metadata.description = starter;
      messages['structured-data'].website.description = starter;
      messages.navigation.siteDescription = starter;
      // Only rendered in states readiness already blocks, or not template copy at all.
      messages.experiment.label = starter;
      messages.contact.panel.unconfiguredMailbox = starter;
      messages.inquiry.form.referenceLabel = 'Reference';
      writeFileSync(file, JSON.stringify(messages));
      writePage(fixture, locale, 'contact', starter, '', starter);
      writePage(fixture, locale, 'privacy', 'Privacy policy — to be completed');
      const issues = readinessIssues(
        productionPrerequisites,
        launchIdentity,
        pathToFileURL(`${fixture}/`),
      );
      assert.deepEqual(
        issues.toSorted(),
        [
          `${locale}/messages home.title still contains template copy`,
          `${locale}/messages home.ruleLabel still contains template copy`,
          `${locale}/messages home.description still contains template copy`,
          `${locale}/messages home.metadata.description still contains template copy`,
          `${locale}/messages structured-data.website.description still contains template copy`,
          `${locale}/messages navigation.siteDescription still contains template copy`,
          `${locale}/contact metadata.seo.title still contains template copy`,
          `${locale}/contact metadata.seo.description still contains template copy`,
          `${locale}/contact content still contains template copy`,
          `${locale}/privacy still contains template legal text`,
        ].toSorted(),
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
  // The starter's Worker name, frozen, in an otherwise launch-ready copy.
  const named = launchFixture();
  try {
    const wrangler = join(named, 'wrangler.jsonc');
    writeFileSync(
      wrangler,
      readFileSync(wrangler, 'utf8').replace(/"name": "[^"]*"/, '"name": "astro-business-starter"'),
    );
    assert.deepEqual(
      readinessIssues(productionPrerequisites, launchIdentity, pathToFileURL(`${named}/`)),
      ["wrangler.jsonc name must be this site's own Worker name, not astro-business-starter"],
    );
  } finally {
    rmSync(named, { recursive: true, force: true });
  }
});

test('readiness rejects a founding year later than the current year', () => {
  const year = new Date().getFullYear();
  const issues = (established) =>
    readinessIssues(productionPrerequisites, {
      ...launchIdentity,
      company: { established },
    }).filter((issue) => issue.includes('company.established'));
  assert.deepEqual(issues(year), []);
  assert.equal(issues(year + 1).length, 1);
});

test('readiness rejects configured root-relative brand files missing from public/', () => {
  const fixture = launchFixture();
  try {
    for (const file of ['share.png', 'icon.svg', 'logo.svg'])
      writeFileSync(join(fixture, 'public', file), 'fixture');
    // A real file just outside public/ must not satisfy a traversal path.
    writeFileSync(join(fixture, 'package.json'), '{}');
    const issues = (brandAssets) =>
      readinessIssues({}, { ...identity, brandAssets }, pathToFileURL(`${fixture}/`)).filter(
        (issue) => issue.endsWith('does not exist under public/'),
      );
    const logo = { status: 'ready', width: 200, height: 40 };
    assert.deepEqual(
      issues({
        ogImage: '/missing-share.png',
        favicon: '/missing-icon.svg',
        logo: { ...logo, horizontal: '/missing-logo.svg' },
      }),
      [
        'brandAssets.ogImage /missing-share.png does not exist under public/',
        'brandAssets.favicon /missing-icon.svg does not exist under public/',
        'brandAssets.logo.horizontal /missing-logo.svg does not exist under public/',
      ],
    );
    assert.deepEqual(
      issues({
        ogImage: '/share.png',
        favicon: '/icon.svg',
        logo: { ...logo, horizontal: '/logo.svg' },
      }),
      [],
    );
    assert.deepEqual(
      issues({ ogImage: 'https://cdn.supplier.co.uk/share.png', favicon: '/icon.svg' }),
      [],
    );
    assert.deepEqual(issues({ ogImage: '/share.png', favicon: '/../package.json' }), [
      'brandAssets.favicon /../package.json does not exist under public/',
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('both launch gates read Wrangler vars, mode dotenv files and the shell, never .dev.vars', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'astro-env-'));
  try {
    writeFileSync(
      join(fixture, 'wrangler.jsonc'),
      `{
        // Deployed plain vars; a PUBLIC_* copy here is runtime-only, not the rendered value.
        "name": "configured-business",
        "vars": {
          "TURNSTILE_ALLOWED_HOSTS": "https://supplier.co.uk",
          "AIRTABLE_TABLE_NAME": "Vars table",
          "PUBLIC_SITE_URL": "https://vars.supplier.co.uk",
        },
      }`,
    );
    writeFileSync(
      join(fixture, '.env.production'),
      'AIRTABLE_TABLE_NAME=Dotenv table\nRESEND_API_KEY=from-dotenv\n',
    );
    writeFileSync(join(fixture, '.dev.vars'), 'RESEND_API_KEY=\nRATE_LIMIT_PEPPER=from-dev-vars\n');
    const env = launchEnv(
      'production',
      { RESEND_API_KEY: 'from-shell' },
      pathToFileURL(`${fixture}/`),
    );
    assert.equal(env.TURNSTILE_ALLOWED_HOSTS, 'https://supplier.co.uk');
    assert.equal(env.AIRTABLE_TABLE_NAME, 'Dotenv table');
    assert.equal(env.RESEND_API_KEY, 'from-shell');
    assert.equal(env.PUBLIC_SITE_URL, undefined);
    assert.equal(env.RATE_LIMIT_PEPPER, undefined);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('real Astro builds use dotenv, mode files and shell precedence for launch readiness', async (suite) => {
  const checkout = resolve('.');
  for (const scenario of [
    {
      name: 'dotenv-only production is refused',
      files: {
        '.env': 'PUBLIC_APP_ENV=production\nPUBLIC_SITE_URL=https://supplier.co.uk\n',
      },
      blocked: true,
    },
    {
      name: 'mode-specific production overrides base dotenv and is refused',
      files: {
        '.env': 'PUBLIC_APP_ENV=experiment\n',
        '.env.review': 'PUBLIC_APP_ENV=production\nPUBLIC_SITE_URL=https://supplier.co.uk\n',
      },
      mode: 'review',
      blocked: true,
    },
    {
      name: 'shell production overrides dotenv experiment and is refused',
      files: { '.env': 'PUBLIC_APP_ENV=experiment\n' },
      env: {
        PUBLIC_APP_ENV: 'production',
        PUBLIC_SITE_URL: 'https://supplier.co.uk',
      },
      blocked: true,
    },
    {
      name: 'shell experiment overrides dotenv production consistently in rendered output',
      files: {
        '.env': 'PUBLIC_APP_ENV=production\nPUBLIC_SITE_URL=https://dotenv.supplier.co.uk\n',
      },
      env: {
        PUBLIC_APP_ENV: 'experiment',
        PUBLIC_SITE_URL: 'https://shell.supplier.co.uk',
      },
      blocked: false,
    },
    {
      name: 'a PUBLIC_APP_ENV variant is refused instead of building a noindex site',
      files: { '.env': 'PUBLIC_APP_ENV=Production\n' },
      blocked: /PUBLIC_APP_ENV must be production or experiment, not "Production"/,
    },
    {
      name: 'a Wrangler var the deploy would ship reaches the production gate',
      files: {
        '.env': Object.entries(productionPrerequisites)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
        'wrangler.jsonc': JSON.stringify({
          name: 'configured-business',
          compatibility_date: '2026-10-19',
          compatibility_flags: ['nodejs_compat'],
          vars: { TURNSTILE_ALLOWED_HOSTS: 'other.co.uk' },
        }),
      },
      ready: true,
      blocked: /TURNSTILE_ALLOWED_HOSTS must include the public site hostname/,
    },
    {
      name: 'blank local .dev.vars do not hide production values from the gate',
      files: {
        '.env': Object.entries(productionPrerequisites)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
        '.dev.vars': 'TURNSTILE_SECRET_KEY=\nRATE_LIMIT_PEPPER=\n',
      },
      ready: true,
      blocked: false,
    },
    {
      name: 'complete syntax-only prerequisites allow a production build without exposing secrets',
      files: {
        '.env': Object.entries(productionPrerequisites)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
      },
      ready: true,
      blocked: false,
    },
    {
      // The derived fixture registers English only and an extra About page.
      name: 'a single-language derived site with an added page passes the production gate',
      root: resolve(derivedRoot),
      files: {
        '.env': Object.entries(productionPrerequisites)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
      },
      ready: true,
      blocked: false,
    },
  ]) {
    await suite.test(scenario.name, async () => {
      const fixture = mkdtempSync(join(tmpdir(), 'astro-config-'));
      const root = scenario.root ?? checkout;
      try {
        for (const name of [
          'src',
          'public',
          'scripts',
          'astro.config.mjs',
          'wrangler.jsonc',
          'tsconfig.json',
          'package.json',
        ]) {
          cpSync(join(root, name), join(fixture, name), { recursive: true });
        }
        symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
        for (const [file, text] of Object.entries(scenario.files))
          writeFileSync(join(fixture, file), text);
        if (scenario.ready) {
          // Approves exactly the languages this copy ships.
          const legalReviewed = Object.fromEntries(contentLocales(fixture).map((l) => [l, true]));
          writeFileSync(
            join(fixture, 'src/site-data.json'),
            JSON.stringify({
              ...launchIdentity,
              readiness: { ...launchIdentity.readiness, legalReviewed },
            }),
          );
          writeLaunchCopy(fixture);
        }
        const env = {
          ...process.env,
          ASTRO_TELEMETRY_DISABLED: '1',
          WRANGLER_SEND_METRICS: 'false',
          WRANGLER_HIDE_BANNER: 'true',
          npm_config_offline: 'true',
          npm_config_update_notifier: 'false',
        };
        delete env.PUBLIC_APP_ENV;
        delete env.PUBLIC_SITE_URL;
        Object.assign(env, scenario.env);
        const args = [
          join(root, 'node_modules/astro/bin/astro.mjs'),
          'build',
          ...(scenario.mode ? ['--mode', scenario.mode] : []),
        ];
        const result = spawnSync(process.execPath, args, {
          cwd: fixture,
          env,
          encoding: 'utf8',
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        assert.ifError(result.error);
        const output = result.stdout + result.stderr;
        if (scenario.blocked) {
          assert.notEqual(result.status, 0, output);
          assert.match(
            output,
            scenario.blocked === true ? /Production build blocked/ : scenario.blocked,
          );
          assert.ok(!existsSync(join(fixture, 'dist/client/index.html')));
        } else {
          assert.equal(result.status, 0, output);
          const html = readFileSync(join(fixture, 'dist/client/index.html'), 'utf8');
          if (scenario.ready) {
            assert.equal(faviconHref(html), launchBrandAssets.favicon);
            assert.doesNotMatch(html, /image\/svg\+xml/);
            assert.match(html, /index,follow,max-image-preview:large/);
            assert.match(html, /data-production="true"/);
            assert.match(html, /<link rel="canonical" href="https:\/\/supplier\.co\.uk\/"/);
            const built = (file) => readFileSync(join(fixture, 'dist/client', file), 'utf8');
            // Tests read the site config with the build's own env: the configured origin.
            const { locales, localeTable, pages, pathFor, canonical } = await loadSite(
              fixture,
              env,
            );
            for (const locale of locales)
              assert.equal(new URL(canonical(locale, 'home')).origin, 'https://supplier.co.uk');
            for (const locale of locales) {
              const page = built(join(pathFor(locale, 'home'), 'index.html').slice(1));
              assert.ok(
                page.includes(`<link rel="canonical" href="${canonical(locale, 'home')}"`),
                locale,
              );
              assert.ok(
                page.includes(
                  `<meta property="og:locale" content="${localeTable[locale].ogLocale}"`,
                ),
                locale,
              );
              // Alternates name the other registered languages only, none on a one-language site.
              assert.equal(
                page.match(/property="og:locale:alternate"/g)?.length ?? 0,
                locales.length - 1,
                locale,
              );
              for (const other of locales.filter((other) => other !== locale))
                assert.ok(
                  page.includes(
                    `<meta property="og:locale:alternate" content="${localeTable[other].ogLocale}"`,
                  ),
                  `${locale} alternate ${other}`,
                );
            }
            // A launched site must be crawlable everywhere except its endpoints.
            assert.deepEqual(built('robots.txt').trimEnd().split('\n'), [
              'User-agent: *',
              'Allow: /',
              'Disallow: /api/',
              'Disallow: /_actions/',
              'Sitemap: https://supplier.co.uk/sitemap.xml',
            ]);
            const sitemap = built('sitemap.xml');
            const entries = sitemap.match(/<url>.*?<\/url>/g) || [];
            const locs = entries.map((entry) => entry.match(/<loc>([^<]+)<\/loc>/)[1]);
            assert.deepEqual(
              locs.toSorted(),
              locales
                .flatMap((locale) =>
                  pages.filter((page) => page.sitemap).map(({ key }) => canonical(locale, key)),
                )
                .toSorted(),
            );
            assert.ok(
              locs.every((loc) => loc.startsWith('https://supplier.co.uk/')),
              sitemap,
            );
            // hreflang alternates are reciprocal: each one is itself a listed URL.
            for (const entry of entries) {
              const alternates = [...entry.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)];
              assert.ok(
                alternates.some(([, language]) => language === 'x-default'),
                entry,
              );
              assert.equal(alternates.length, locales.length + 1, entry);
              for (const [, , href] of alternates) assert.ok(locs.includes(href), href);
            }
            const client = readdirSync(join(fixture, 'dist/client'), {
              recursive: true,
            })
              .filter((file) => /\.(html|js)$/.test(file))
              .map((file) => readFileSync(join(fixture, 'dist/client', file), 'utf8'))
              .join('\n');
            for (const [key, value] of Object.entries(productionPrerequisites).filter(([key]) =>
              /SECRET|TOKEN|API_KEY|PEPPER/.test(key),
            )) {
              assert.ok(!client.includes(value), `${key} must not appear in client assets`);
              assert.ok(!client.includes(key), `${key} must not appear in client assets`);
            }
            // On-demand routes import the site config in workerd, where module-scope time is 1970.
            const h = await startHarness({ root: fixture });
            try {
              for (const path of ['/missing', '/es/missing'])
                assert.equal(
                  (await h.mf.dispatchFetch(`http://localhost${path}`)).status,
                  404,
                  path,
                );
            } finally {
              await h.close();
            }
          } else {
            assert.equal(faviconHref(html), identity.brandAssets.favicon);
            assert.match(html, /noindex,nofollow/);
            assert.match(html, /data-production="false"/);
            assert.match(html, /https:\/\/shell\.supplier\.co\.uk/);
            assert.doesNotMatch(html, /https:\/\/dotenv\.supplier\.co\.uk/);
          }
        }
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }
});

// Runs on the derived-site fixture build (`npm run build:test`), which configures a logo
// and social links the template leaves empty.
test('a derived site with its own logo and social links renders them without template leftovers', async () => {
  const { site, locales, pathFor, messages } = await loadSite(derivedRoot);
  const { logo } = site.brandAssets;
  assert.equal(logo?.status, 'ready', 'the derived fixture configures a logo');
  const social = Object.entries(site.social ?? {}).filter(([, href]) => href);
  assert.ok(social.length > 0, 'the derived fixture configures social links');
  const names = { linkedin: 'LinkedIn', twitter: 'X' };
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const locale of locales) {
    const file = join(pathFor(locale, 'home'), 'index.html').slice(1);
    const html = readFileSync(join(derivedRoot, 'dist/client', file), 'utf8');
    const newTab = messages(locale).accessibility.opensInNewTab;
    // The header shows the configured logo alone, not next to the template's chat mark.
    const brand = html.match(/<a class="brand"[^>]*>([\s\S]*?)<\/a>/)[1];
    assert.match(
      brand,
      new RegExp(`<img src="${escape(logo.horizontal)}"[^>]*alt="${escape(site.name)}"`),
    );
    assert.doesNotMatch(html, /brand-mark/, file);
    // Social links read as brand names; the arrow is decorative and the new tab is announced.
    const spoken = (href) => {
      const link = html.match(new RegExp(`<a href="${escape(href)}"[^>]*>([\\s\\S]*?)</a>`));
      assert.ok(link, `${file} links ${href}`);
      assert.match(link[0], /target="_blank"/);
      assert.match(link[1], /<span aria-hidden="true">↗<\/span>/);
      return decodeHtml(
        link[1].replace(/<span aria-hidden="true">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, ''),
      )
        .replace(/\s+/g, ' ')
        .trim();
    };
    for (const [network, href] of social)
      assert.equal(spoken(href), `${names[network]} (${newTab})`, `${file} ${network}`);
  }
});

// A frozen byte copy of the starter share image, independent of what public/ ships.
test('readiness rejects the starter share image as a launch share image', () => {
  const fixture = launchFixture();
  try {
    cpSync(resolve('tests/fixtures/template-share.png'), join(fixture, 'public/starter-share.png'));
    assert.deepEqual(
      readinessIssues(
        productionPrerequisites,
        {
          ...launchIdentity,
          brandAssets: { ...launchIdentity.brandAssets, ogImage: '/starter-share.png' },
        },
        pathToFileURL(`${fixture}/`),
      ),
      ['brandAssets.ogImage /starter-share.png is still the template share image'],
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('browser tests refuse a server already on their port instead of testing it', async () => {
  // Stands in for a test server left running by another checkout or an older build.
  const stale = createHttpServer((request, response) => response.end('{"status":"ok"}'));
  await new Promise((done) => stale.listen(0, '127.0.0.1', done));
  const output = mkdtempSync(join(tmpdir(), 'astro-stale-'));
  try {
    const { port } = stale.address();
    if (port > 65532) return; // TEST_PORT needs three more ports above it
    const env = { ...process.env, TEST_PORT: String(port) };
    // The local default, outside CI and without the explicit opt-in.
    delete env.CI;
    delete env.PLAYWRIGHT_REUSE_EXISTING_SERVER;
    const result = await new Promise((done) => {
      const child = spawn(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--project=template',
          '--grep=unknown routes',
          '--reporter=line',
          `--output=${output}`,
        ],
        { env },
      );
      let text = '';
      child.stdout.on('data', (chunk) => (text += chunk));
      child.stderr.on('data', (chunk) => (text += chunk));
      child.on('close', (status) => done({ status, text }));
    });
    assert.notEqual(result.status, 0, result.text);
    assert.match(result.text, new RegExp(`127\\.0\\.0\\.1:${port}/api/health is already used`));
    assert.doesNotMatch(result.text, /passed/);
  } finally {
    stale.close();
    rmSync(output, { recursive: true, force: true });
  }
});
