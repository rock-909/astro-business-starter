# Source adoption and license boundaries

## Project source

This experiment adapts an owner-provided website reference with the owner's authorization to reuse and publish the included code and content. The original repository, its history, reference snapshots and internal working notes are not part of this public package.

The retained or adapted material includes:

| Public files | Treatment |
|---|---|
| `src/content/{en,es}/` | Localized reference copy; neutral public branding and local type imports |
| `src/site-schema.ts` | Pure configuration schema adapted to Astro's Zod import |
| `src/components/content/{heading-id,static-markdown-blocks}.ts` | Pure content helpers reused |
| `src/lib/{attribution,text,ip-range,lead-utils}.ts` | Validation, sanitization, IP and formatting helpers reused |
| `src/lib/inquiry-schema.ts` | Canonical input schema adapted to local imports/constants |
| Browser modules and `src/lib/inquiry.ts` | Attribution, consent, form and delivery behavior adapted to Astro |

The Astro layout, stylesheet, browser integration, Action/Worker glue, harness and regression tests were authored for this experiment. No third-party website template, supplier photograph, logo, font or marketing claim is bundled. `public/icon.svg` and `public/opengraph-image.svg` are original code-native graphics; the PNG is a raster export of the SVG.

No project-wide open-source license is assigned in this repository. Publication is not a blanket license grant for the project content. The dependency licenses below apply to their respective upstream packages, not automatically to this project's code or content. No third-party copyright or license notices have been removed from included source files.

## Dependencies

The lockfile retains the complete dependency tree, registry locations, integrity hashes and declared license metadata. Dependencies are installed separately; their code/binaries are not bundled in the source archive. Preserve their upstream license and notice files when distributing installed dependencies or built artifacts.

Exact installed versions, including transitive ones, are recorded in `package-lock.json`; this table names the main packages and their declared licenses, not versions.

| Package | Declared upstream license |
|---|---|
| astro | MIT |
| @astrojs/cloudflare | MIT |
| @astrojs/check | MIT |
| @emnapi/runtime (peer required by `@astrojs/check`'s WASM runtime) | MIT |
| @playwright/test | Apache-2.0 |
| typescript | Apache-2.0 |
| wrangler | MIT OR Apache-2.0 |
| miniflare (Wrangler transitive) | MIT |
| workerd (Miniflare transitive) | Apache-2.0 |

Local browser verification used Chromium headless-shell 153.0.8010.0 supplied by `@sparticuz/chromium` 153.0.0. Neither that tooling nor its binaries are part of this project's dependency graph or source archive; Chromium has its own upstream notices.

## Framework references

- [Astro Actions](https://docs.astro.build/en/guides/actions/)
- [Astro Cloudflare integration](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Cloudflare Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/)

The test harness uses the Miniflare/workerd bundled by the pinned Wrangler, rather than a separately selected simulator version. Provider redirects never count as delivery acceptance.
