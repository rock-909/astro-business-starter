import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { loadEnv } from "vite";
import { readinessIssues } from "./scripts/readiness.mjs";

const publicShellEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith("PUBLIC_")),
);

export default defineConfig({
  // src/site.ts owns the public origin. Wait for Vite's actual mode and env
  // precedence instead of checking shell values before dotenv has been loaded.
  vite: {
    plugins: [
      {
        name: "production-readiness",
        enforce: "pre",
        config() {
          // ponytail: adapter 14.4.2 overwrites public env; remove this restoration
          // when it preserves Vite precedence (covered by real-build tests).
          // Restore the actual shell inputs so Vite can apply shell > mode > base
          // precedence consistently. Worker-only bindings are left untouched.
          for (const key of Object.keys(process.env)) {
            if (key.startsWith("PUBLIC_")) delete process.env[key];
          }
          Object.assign(process.env, publicShellEnv);
        },
        configResolved(config) {
          if (config.env.PUBLIC_APP_ENV !== "production") return;
          const issues = readinessIssues(
            loadEnv(config.mode, config.envDir, ""),
          );
          if (issues.length)
            throw new Error(`Production build blocked:\n${issues.join("\n")}`);
        },
      },
    ],
  },
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
    inspectorPort: false,
    prerenderEnvironment: "node",
  }),
  session: false,
  trailingSlash: "never",
  security: { actionBodySizeLimit: 65536 },
  devToolbar: { enabled: false },
});
