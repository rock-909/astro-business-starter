import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { assertValidSiteConfig } from '../src/site-schema.ts';
import { launchEnv, readinessIssues } from '../scripts/readiness.mjs';
import { startHarness } from './harness.mjs';

const identity = JSON.parse(
  readFileSync(new URL('../src/site-data.json', import.meta.url), 'utf8'),
);
// Owner-rewritten copy for every template phrase a derived site must replace before launch,
// plus its own share image and Worker name.
const launchCopy = 'Owner approved copy';
function writeLaunchCopy(root) {
  writeFileSync(join(root, 'public/opengraph-image.png'), 'owner share image');
  const wrangler = join(root, 'wrangler.jsonc');
  writeFileSync(
    wrangler,
    readFileSync(wrangler, 'utf8').replace(
      '"name": "astro-business-starter"',
      '"name": "configured-business"',
    ),
  );
  for (const locale of ['en', 'es']) {
    const file = join(root, `src/content/${locale}/messages.json`);
    const messages = JSON.parse(readFileSync(file, 'utf8'));
    messages.home.metadata.description = launchCopy;
    messages.home.title = launchCopy;
    messages.home.description = launchCopy;
    messages.home.ruleLabel = launchCopy;
    messages.home.eyebrow = launchCopy;
    messages['structured-data'].website.description = launchCopy;
    messages.navigation.siteDescription = launchCopy;
    writeFileSync(file, JSON.stringify(messages));
    // A leftover comment naming the starter is not page copy.
    writeFileSync(
      join(root, `src/content/${locale}/contact.ts`),
      `import type { ContentPage } from '../../site';
// Replaced reference site copy
const contactPage = ${JSON.stringify({
        metadata: {
          title: 'Contact',
          updatedAt: '2026-10-25',
          seo: { title: 'Contact', description: launchCopy },
        },
        content: launchCopy,
      })} satisfies ContentPage;
export default contactPage;
`,
    );
    for (const page of ['privacy', 'terms'])
      writeFileSync(
        join(root, `src/content/${locale}/${page}.ts`),
        `export default ${JSON.stringify({
          metadata: {
            title: page,
            updatedAt: '2026-10-25',
            seo: { title: page, description: 'Owner approved legal copy' },
          },
          content: 'Owner approved legal copy',
        })};`,
      );
  }
}
const launchIdentity = {
  ...identity,
  name: 'Configured business',
  description: 'Owner confirmed business identity',
  seo: {
    titleTemplate: '%s | Configured business',
    defaultTitle: 'Configured business',
    defaultDescription: launchCopy,
  },
  company: { established: 2004 },
  contact: { email: 'sales@supplier.co.uk' },
  readiness: { ownerConfirmedIdentity: true, legalReviewed: { en: true, es: true } },
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

test('EN and ES messages define the same keys with the same value shapes', () => {
  // Browser copy is typed from EN only, so a missing ES key would otherwise pass `npm run check`.
  const shapes = (value, path = '') =>
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) => shapes(child, `${path}/${key}`))
      : [`${path}: ${typeof value}`];
  const [en, es] = ['en', 'es'].map((locale) =>
    shapes(
      JSON.parse(
        readFileSync(new URL(`../src/content/${locale}/messages.json`, import.meta.url), 'utf8'),
      ),
    ).sort(),
  );
  assert.deepEqual(es, en);
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

test('readiness rejects shipped template copy and accepts owner-rewritten copy', () => {
  const shipped = readinessIssues(productionPrerequisites, {
    ...launchIdentity,
    seo: identity.seo,
  });
  for (const issue of [
    "wrangler.jsonc name must be this site's own Worker name, not astro-business-starter",
    'brandAssets.ogImage /opengraph-image.png is still the template share image',
    'en/messages home.title still contains template copy',
    'en/messages home.ruleLabel still contains template copy',
    'es/messages home.title still contains template copy',
    'es/messages home.ruleLabel still contains template copy',
    'seo.titleTemplate still contains template copy',
    'seo.defaultDescription still contains template copy',
    'en/messages home.metadata.description still contains template copy',
    'en/messages structured-data.website.description still contains template copy',
    'en/messages navigation.siteDescription still contains template copy',
    'es/messages home.metadata.description still contains template copy',
    'es/messages structured-data.website.description still contains template copy',
    'es/messages navigation.siteDescription still contains template copy',
    'en/contact metadata.seo.title still contains template copy',
    'en/contact metadata.seo.description still contains template copy',
    'en/contact content still contains template copy',
    'es/contact metadata.seo.title still contains template copy',
    'es/contact metadata.seo.description still contains template copy',
    'es/contact content still contains template copy',
  ])
    assert.ok(shipped.includes(issue), issue);
  // Only rendered in states readiness already blocks, or not template copy at all.
  assert.ok(
    !shipped.some((issue) => /experiment\.|unconfiguredMailbox|referenceLabel/.test(issue)),
    shipped.join('\n'),
  );

  const fixture = mkdtempSync(join(tmpdir(), 'astro-copy-'));
  try {
    cpSync(resolve('src/content'), join(fixture, 'src/content'), { recursive: true });
    cpSync(resolve('public'), join(fixture, 'public'), { recursive: true });
    cpSync(resolve('wrangler.jsonc'), join(fixture, 'wrangler.jsonc'));
    writeLaunchCopy(fixture);
    assert.deepEqual(
      readinessIssues(productionPrerequisites, launchIdentity, pathToFileURL(`${fixture}/`)),
      [],
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
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
  const issues = (brandAssets) =>
    readinessIssues({}, { ...identity, brandAssets }).filter((issue) =>
      issue.endsWith('does not exist under public/'),
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
      ogImage: 'https://cdn.supplier.co.uk/share.png',
      favicon: '/icon.svg',
      logo: { ...logo, horizontal: '/opengraph-image.svg' },
    }),
    [],
  );
  assert.deepEqual(issues({ ...identity.brandAssets, favicon: '/../package.json' }), [
    'brandAssets.favicon /../package.json does not exist under public/',
  ]);
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
  const root = resolve('.');
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
  ]) {
    await suite.test(scenario.name, async () => {
      const fixture = mkdtempSync(join(tmpdir(), 'astro-config-'));
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
          // A derived site may ship a raster favicon instead of the template SVG.
          cpSync(join(root, 'public/opengraph-image.png'), join(fixture, 'public/brand-icon.png'));
          writeFileSync(
            join(fixture, 'src/site-data.json'),
            JSON.stringify({
              ...launchIdentity,
              brandAssets: { ...launchIdentity.brandAssets, favicon: '/brand-icon.png' },
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
            assert.match(html, /<link rel="icon" href="\/brand-icon.png">/);
            assert.doesNotMatch(html, /image\/svg\+xml/);
            assert.match(html, /index,follow,max-image-preview:large/);
            assert.match(html, /data-production="true"/);
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
            assert.match(html, /<link rel="icon" href="\/icon.svg">/);
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

test('a derived site with its own logo and social links renders them without template leftovers', () => {
  const root = resolve('.');
  const fixture = mkdtempSync(join(tmpdir(), 'astro-derived-'));
  try {
    for (const name of ['src', 'public', 'scripts', 'astro.config.mjs', 'tsconfig.json'])
      cpSync(join(root, name), join(fixture, name), { recursive: true });
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
    writeFileSync(
      join(fixture, 'src/site-data.json'),
      JSON.stringify({
        ...identity,
        social: {
          linkedin: 'https://www.linkedin.com/company/supplier',
          twitter: 'https://x.com/supplier',
        },
        brandAssets: {
          ...identity.brandAssets,
          logo: { status: 'ready', horizontal: '/logo.svg', width: 160, height: 40 },
        },
      }),
    );
    const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', PUBLIC_APP_ENV: 'experiment' };
    const result = spawnSync(
      process.execPath,
      [join(root, 'node_modules/astro/bin/astro.mjs'), 'build'],
      { cwd: fixture, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const [file, newTab] of [
      ['index.html', 'opens in a new tab'],
      ['es/index.html', 'se abre en una pestaña nueva'],
    ]) {
      const html = readFileSync(join(fixture, 'dist/client', file), 'utf8');
      // The header shows the configured logo alone, not next to the template's chat mark.
      const brand = html.match(/<a class="brand"[^>]*>([\s\S]*?)<\/a>/)[1];
      assert.match(brand, /<img src="\/logo\.svg"[^>]*alt="Astro Business Starter"/);
      assert.doesNotMatch(html, /brand-mark/, file);
      // Social links read as brand names; the arrow is decorative and the new tab is announced.
      const spoken = (href) => {
        const link = html.match(new RegExp(`<a href="${href}"[^>]*>([\\s\\S]*?)</a>`));
        assert.ok(link, `${file} links ${href}`);
        assert.match(link[0], /target="_blank"/);
        assert.match(link[1], /<span aria-hidden="true">↗<\/span>/);
        return link[1]
          .replace(/<span aria-hidden="true">[^<]*<\/span>/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      };
      assert.equal(spoken('https://www.linkedin.com/company/supplier'), `LinkedIn (${newTab})`);
      assert.equal(spoken('https://x.com/supplier'), `X (${newTab})`);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
