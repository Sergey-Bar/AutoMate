import { parseConfig, type AppConfig as CanonicalConfig } from '@automate/config';

export type AppConfig = Omit<Partial<CanonicalConfig>, 'nodeEnv' | 'port'> & {
  nodeEnv: string;
  port: number;
  databaseUrl?: string;
  cookieSecret?: string;
  reporterSecret?: string;
  apiKey?: string;
  vaultSecret?: string;
};

export function getConfig(): AppConfig {
  const canonical = parseConfig(process.env);
  return {
    ...canonical,
    apiKey: canonical.installationApiKey,
  };
}
