/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN. A public key by design: the browser has to be able to send events. */
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  /** Read at build time by the Sentry Vite plugin, not by application code. */
  readonly VITE_SENTRY_ORG?: string;
  readonly VITE_SENTRY_PROJECT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
