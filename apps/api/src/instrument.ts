import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSentry } from './observability/sentry.js';

/**
 * Load `.env` before anything reads `process.env`.
 *
 * `.env.example` documents the whole surface and `.gitignore` covers `.env`, so a local
 * `.env` is the intended way to configure a development machine — but nothing read it.
 * The API read `process.env` directly, so a value in `.env` was silently ignored and the
 * startup policy refused to boot:
 *
 * ```
 * Error: AUTOMATE_API_KEY is required. Set it, or set AUTOMATE_ALLOW_DEV_SECRETS=1 ...
 * ```
 *
 * **which is advice that did not work**, because `pnpm dev` runs through Turborepo, whose
 * strict environment mode passes only declared variables — so even exporting the variable
 * in the shell did not reach this process. `process.loadEnvFile` is Node's own and needs no
 * dependency; Vite already loads `.env` for the web app, so this is the API's half.
 *
 * Root first, because that is where `.env.example` lives and where an operator writes one.
 * Both are skipped when absent, so a container that takes its environment from the
 * orchestrator is unaffected.
 *
 * Values already in the environment win: `loadEnvFile` does not overwrite them, so an
 * explicit `AUTOMATE_ALLOW_DEV_SECRETS=1 pnpm dev` still overrides the file.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
for (const candidate of [
  path.resolve(here, '../../..', '.env'),
  path.resolve(here, '../../.env'),
  path.resolve(here, '../../../.env'),
]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

// Preloaded via `--import` so the SDK is live before the module graph is
// evaluated. `getConfig()` and `checkProductionPolicy()` both throw on a
// misconfigured deployment, and that failure happens while `index.ts` is still
// importing, which is too early for a call made from inside it.
initSentry();
