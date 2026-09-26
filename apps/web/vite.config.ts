import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

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
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
