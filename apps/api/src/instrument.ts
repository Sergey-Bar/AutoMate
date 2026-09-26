import { initSentry } from './observability/sentry.js';

// Preloaded via `--import` so the SDK is live before the module graph is
// evaluated. `getConfig()` and `checkProductionPolicy()` both throw on a
// misconfigured deployment, and that failure happens while `index.ts` is still
// importing, which is too early for a call made from inside it.
initSentry();
