export interface ProductionSecrets {
  nodeEnv?: string;
  cookieSecret?: string;
  reporterSecret?: string;
  serviceSecret?: string;
}

export function checkProductionPolicy(secrets: ProductionSecrets): void {
  if (secrets.nodeEnv !== 'production') return;
  if (!secrets.cookieSecret) throw new Error('COOKIE_SECRET is required in production');
  if (!secrets.reporterSecret) throw new Error('REPORTER_SECRET is required in production');
}
