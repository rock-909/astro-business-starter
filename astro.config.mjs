import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { launchEnv, readinessIssues } from './scripts/readiness.mjs';

// The shell as it was before the adapter imports Wrangler vars and .dev.vars into process.env.
const shellEnv = { ...process.env };
const publicShellEnv = Object.fromEntries(
  Object.entries(shellEnv).filter(([key]) => key.startsWith('PUBLIC_')),
);

export default defineConfig({
  // src/site.ts owns the public origin. Wait for Vite's actual mode and env
  // precedence instead of checking shell values before dotenv has been loaded.
  vite: {
    plugins: [
      {
        name: 'production-readiness',
        enforce: 'pre',
        config() {
          // ponytail: adapter 14.4.2 overwrites public env; remove this restoration
          // when it preserves Vite precedence (covered by real-build tests).
          // Restore the actual shell inputs so Vite can apply shell > mode > base
          // precedence consistently. Worker-only bindings are left untouched.
          for (const key of Object.keys(process.env)) {
            if (key.startsWith('PUBLIC_')) delete process.env[key];
          }
          Object.assign(process.env, publicShellEnv);
        },
        configResolved(config) {
          const appEnv = config.env.PUBLIC_APP_ENV;
          // Anything else (Production, prod) would build a noindex site past the gate.
          if (appEnv && appEnv !== 'production' && appEnv !== 'experiment')
            throw new Error(`PUBLIC_APP_ENV must be production or experiment, not "${appEnv}"`);
          if (appEnv !== 'production') return;
          // Same sources as `npm run readiness`; see launchEnv.
          const issues = readinessIssues(launchEnv(config.mode, shellEnv));
          if (issues.length) throw new Error(`Production build blocked:\n${issues.join('\n')}`);
        },
      },
    ],
  },
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough',
    inspectorPort: false,
    prerenderEnvironment: 'node',
  }),
  session: false,
  trailingSlash: 'never',
  security: { actionBodySizeLimit: 65536 },
  devToolbar: { enabled: false },
});
