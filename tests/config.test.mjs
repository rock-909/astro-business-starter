import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { assertValidSiteConfig } from "../src/site-schema.ts";
import { readinessIssues } from "../scripts/readiness.mjs";

const identity = JSON.parse(
  readFileSync(new URL("../src/site-data.json", import.meta.url), "utf8"),
);
// Inert syntax-only prerequisites; no request is made to these hosts/providers.
const productionPrerequisites = {
  PUBLIC_APP_ENV: "production",
  PUBLIC_SITE_URL: "https://supplier.co.uk",
  PUBLIC_TURNSTILE_SITE_KEY: "opaque-public-key",
  TURNSTILE_SECRET_KEY: "opaque-verification-value",
  RESEND_API_KEY: "opaque-email-value",
  RESEND_FROM_EMAIL: "sales@supplier.co.uk",
  INQUIRY_TO_EMAIL: "sales@supplier.co.uk",
  AIRTABLE_API_KEY: "opaque-crm-value",
  AIRTABLE_BASE_ID: "app01234567890",
  AIRTABLE_TABLE_NAME: "Leads",
  UPSTASH_REDIS_REST_URL: "https://redis.supplier.co.uk",
  UPSTASH_REDIS_REST_TOKEN: "opaque-rate-value",
  RATE_LIMIT_PEPPER: "abcdefghijklmnopqrstuvwxyz0123456789",
};

test("optional company facts are validated and consumed without requiring an organization", async () => {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { site, jsonLd } = await server.ssrLoadModule("/src/site.ts");
    for (const company of [
      undefined,
      {},
      { established: 2000 },
      { name: "" },
    ]) {
      assertValidSiteConfig({ ...identity, company });
      site.company = company;
      const graph = JSON.parse(jsonLd("en", "home", "Title", "Description"))[
        "@graph"
      ];
      assert.ok(!graph.some((item) => item["@type"] === "Organization"));
    }
    const company = {
      name: "Configured business",
      established: 2000,
      location: { address: "1 Main Street", city: "Madrid", country: "ES" },
    };
    const parsed = assertValidSiteConfig({
      ...identity,
      company,
      unknown: "discard",
    });
    assert.deepEqual(parsed.company, company);
    assert.deepEqual(parsed.readiness, identity.readiness);
    assert.equal(parsed.unknown, undefined);
    site.company = parsed.company;
    const organization = JSON.parse(
      jsonLd("en", "home", "Title", "Description"),
    )["@graph"].find((item) => item["@type"] === "Organization");
    assert.equal(organization.name, company.name);
    assert.equal(organization.address.addressLocality, "Madrid");
    assert.equal(organization.foundingDate, "2000");
  } finally {
    await server.close();
  }
});

test("company consumer fields reject invalid types at the configuration boundary", () => {
  for (const [company, path] of [
    [{ name: 123 }, "company.name"],
    [{ location: "Madrid" }, "company.location"],
    [{ location: { address: 42 } }, "company.location.address"],
    [{ location: { city: 42 } }, "company.location.city"],
    [{ location: { country: 42 } }, "company.location.country"],
  ]) {
    assert.throws(
      () => assertValidSiteConfig({ ...identity, company }),
      (error) => error.message.includes(path),
      path,
    );
  }
});

test("readiness requires nonblank identity and SEO text even after owner confirmation", () => {
  for (const path of [
    "name",
    "description",
    "seo.titleTemplate",
    "seo.defaultTitle",
    "seo.defaultDescription",
  ]) {
    for (const blank of ["", "   "]) {
      const configured = structuredClone(identity);
      configured.readiness.ownerConfirmedIdentity = true;
      const [parent, key] = path.split(".");
      if (key) configured[parent][key] = blank;
      else configured[parent] = blank;
      assert.ok(
        readinessIssues({}, configured).includes(
          `${path} must contain nonblank text`,
        ),
        `${path}: ${JSON.stringify(blank)}`,
      );
    }
  }
});

test("real Astro builds use dotenv, mode files and shell precedence for launch readiness", async (suite) => {
  const root = resolve(".");
  for (const scenario of [
    {
      name: "dotenv-only production is refused",
      files: {
        ".env":
          "PUBLIC_APP_ENV=production\nPUBLIC_SITE_URL=https://supplier.co.uk\n",
      },
      blocked: true,
    },
    {
      name: "mode-specific production overrides base dotenv and is refused",
      files: {
        ".env": "PUBLIC_APP_ENV=experiment\n",
        ".env.review":
          "PUBLIC_APP_ENV=production\nPUBLIC_SITE_URL=https://supplier.co.uk\n",
      },
      mode: "review",
      blocked: true,
    },
    {
      name: "shell production overrides dotenv experiment and is refused",
      files: { ".env": "PUBLIC_APP_ENV=experiment\n" },
      env: {
        PUBLIC_APP_ENV: "production",
        PUBLIC_SITE_URL: "https://supplier.co.uk",
      },
      blocked: true,
    },
    {
      name: "shell experiment overrides dotenv production consistently in rendered output",
      files: {
        ".env":
          "PUBLIC_APP_ENV=production\nPUBLIC_SITE_URL=https://dotenv.supplier.co.uk\n",
      },
      env: {
        PUBLIC_APP_ENV: "experiment",
        PUBLIC_SITE_URL: "https://shell.supplier.co.uk",
      },
      blocked: false,
    },
    {
      name: "complete syntax-only prerequisites allow a production build without exposing secrets",
      files: {
        ".env": Object.entries(productionPrerequisites)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
      },
      ready: true,
      blocked: false,
    },
  ]) {
    await suite.test(scenario.name, () => {
      const fixture = mkdtempSync(join(tmpdir(), "astro-config-"));
      try {
        for (const name of [
          "src",
          "public",
          "scripts",
          "astro.config.mjs",
          "wrangler.jsonc",
          "tsconfig.json",
          "package.json",
        ]) {
          cpSync(join(root, name), join(fixture, name), { recursive: true });
        }
        symlinkSync(
          join(root, "node_modules"),
          join(fixture, "node_modules"),
          "dir",
        );
        for (const [file, text] of Object.entries(scenario.files))
          writeFileSync(join(fixture, file), text);
        if (scenario.ready) {
          writeFileSync(
            join(fixture, "src/site-data.json"),
            JSON.stringify({
              ...identity,
              name: "Configured business",
              description: "Owner confirmed business identity",
              contact: { email: "sales@supplier.co.uk" },
              readiness: {
                ownerConfirmedIdentity: true,
                legalReviewed: { en: true, es: true },
              },
            }),
          );
          for (const locale of ["en", "es"])
            for (const page of ["privacy", "terms"]) {
              writeFileSync(
                join(fixture, `src/content/${locale}/${page}.ts`),
                `export default ${JSON.stringify({
                  metadata: {
                    title: page,
                    updatedAt: "2026-10-25",
                    seo: {
                      title: page,
                      description: "Owner approved legal copy",
                    },
                  },
                  content: "Owner approved legal copy",
                })};`,
              );
            }
        }
        const env = {
          ...process.env,
          ASTRO_TELEMETRY_DISABLED: "1",
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_HIDE_BANNER: "true",
          npm_config_offline: "true",
          npm_config_update_notifier: "false",
        };
        delete env.PUBLIC_APP_ENV;
        delete env.PUBLIC_SITE_URL;
        Object.assign(env, scenario.env);
        const args = [
          join(root, "node_modules/astro/bin/astro.mjs"),
          "build",
          ...(scenario.mode ? ["--mode", scenario.mode] : []),
        ];
        const result = spawnSync(process.execPath, args, {
          cwd: fixture,
          env,
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        assert.ifError(result.error);
        const output = result.stdout + result.stderr;
        if (scenario.blocked) {
          assert.notEqual(result.status, 0, output);
          assert.match(output, /Production build blocked/);
          assert.ok(!existsSync(join(fixture, "dist/client/index.html")));
        } else {
          assert.equal(result.status, 0, output);
          const html = readFileSync(
            join(fixture, "dist/client/index.html"),
            "utf8",
          );
          if (scenario.ready) {
            assert.match(html, /index,follow,max-image-preview:large/);
            assert.match(html, /data-production="true"/);
            const client = readdirSync(join(fixture, "dist/client"), {
              recursive: true,
            })
              .filter((file) => /\.(html|js)$/.test(file))
              .map((file) =>
                readFileSync(join(fixture, "dist/client", file), "utf8"),
              )
              .join("\n");
            for (const [key, value] of Object.entries(
              productionPrerequisites,
            ).filter(([key]) => /SECRET|TOKEN|API_KEY|PEPPER/.test(key))) {
              assert.ok(
                !client.includes(value),
                `${key} must not appear in client assets`,
              );
              assert.ok(
                !client.includes(key),
                `${key} must not appear in client assets`,
              );
            }
          } else {
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
