export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string | undefined;
  cookieSecret: string | undefined;
  reporterSecret: string | undefined;
  automateServiceSecret: string | undefined;
  corsOrigin: string | undefined;
  apiKey: string | undefined;
  vaultSecret: string | undefined;
  /** When true, the reporter ingress accepts `?token=` query-param auth (legacy compat). Defaults to false. */
  reporterQueryTokenCompat: boolean;
}

export function getConfig(): AppConfig {
  return {
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    databaseUrl: process.env['DATABASE_URL'],
    cookieSecret: process.env['COOKIE_SECRET'] ?? process.env['SESSION_SECRET'],
    reporterSecret: process.env['REPORTER_SECRET'],
    automateServiceSecret: process.env['AUTOMATE_SERVICE_SECRET'],
    corsOrigin: process.env['CORS_ORIGIN'],
    apiKey: process.env['AUTOMATE_API_KEY'],
    vaultSecret: process.env['VAULT_SECRET'],
    reporterQueryTokenCompat: process.env['REPORTER_QUERY_TOKEN_COMPAT'] === 'true',
  };
}
