import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { apiProxyTarget } from '@automate/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // Uploading source maps needs an auth token; the DSN alone is a public key
  // and cannot upload. Gating on the token rather than the DSN means CI, which
  // has neither, gets a working build instead of a failed one, and so does a
  // contributor who never set Sentry up at all.
  const authToken = process.env.SENTRY_AUTH_TOKEN;

  return {
    plugins: [
      ...sentryVitePlugin({
        // `disable` is the only safe default here: an unconfigured or tokenless
        // build must not warn on every run, and `sourcemaps.disable-upload`
        // alone would still inject debug IDs into artifacts nobody can resolve.
        disable: !authToken,
        authToken,
        org: env.VITE_SENTRY_ORG,
        project: env.VITE_SENTRY_PROJECT,
        telemetry: false,
      }),
      react(),
      tailwindcss(),
    ],
    server: {
      proxy: {
        '/api': {
          // Derived from the same `PORT` the API reads, not a literal. This was
          // `http://127.0.0.1:3000`, and `README.md` told the reader to start the
          // API on 3456 — so following the documentation exactly produced a
          // dashboard whose API calls went nowhere, with no error to explain it.
          // `packages/config/src/config.test.ts` fails if a literal returns here.
          //
          // Read with an empty prefix, from the **repository root** rather than
          // Vite's own root.
          //
          // `loadEnv` resolves relative to the path it is given, and Vite's root is
          // `apps/web` — so the obvious call reads `apps/web/.env*`, which nothing
          // creates. The one `.env` file this repository has is `.env.example` at
          // the root, and the API has no dotenv loader at all, so a `PORT` in a file
          // is aspirational either way. The shell is the only place it can really
          // come from, and the tests assert that the proxy and the API agree on the
          // value they *do* get rather than pretending the file path works.
          target: apiProxyTarget({
            ...loadEnv(mode, path.resolve(__dirname, '../..'), ''),
            ...process.env,
          }),
          changeOrigin: true,
        },
      },
    },
  };
});
