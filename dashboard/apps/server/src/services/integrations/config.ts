/**
 * config.ts — Integration configuration I/O
 *
 * Extracted from routes/integrations.ts to break the circular dependency:
 *   routes/integrations.ts → services/integrations/webhooks.ts → routes/integrations.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

const CONFIG_PATH = path.resolve(process.cwd(), '.automate', 'integrations.json');

const WebhookEntrySchema = z.object({
  url: z.string(),
  events: z.array(z.string()),
});

/** Zod schema for the on-disk integrations.json — validates file contents at read time. */
export const IntegrationConfigSchema = z.object({
  slack: z
    .object({
      webhookUrl: z.string().optional(),
      enabled: z.boolean().optional(),
      notifyOn: z.array(z.enum(['passed', 'failed', 'all'])).optional(),
    })
    .optional(),
  jira: z
    .object({
      baseUrl: z.string().optional(),
      email: z.string().optional(),
      apiToken: z.string().optional(),
      projectKey: z.string().optional(),
      enabled: z.boolean().optional(),
      autoCreateBugs: z.boolean().optional(),
    })
    .optional(),
  github: z
    .object({
      token: z.string().optional(),
      owner: z.string().optional(),
      repo: z.string().optional(),
      enabled: z.boolean().optional(),
      prComments: z.boolean().optional(),
      commitStatus: z.boolean().optional(),
      checkRuns: z.boolean().optional(),
      defaultBaseBranch: z.string().optional(),
      ignoreFlakyInComments: z.boolean().optional(),
    })
    .optional(),
  gitlab: z
    .object({
      token: z.string().optional(),
      projectId: z.string().optional(),
      baseUrl: z.string().optional(),
      enabled: z.boolean().optional(),
      mrComments: z.boolean().optional(),
      defaultBaseBranch: z.string().optional(),
    })
    .optional(),
  webhooks: z.array(WebhookEntrySchema).optional(),
  email: z
    .object({
      host: z.string().optional(),
      port: z.number().optional(),
      secure: z.boolean().optional(),
      user: z.string().optional(),
      pass: z.string().optional(),
      recipients: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
    })
    .optional(),
  teams: z
    .object({
      webhookUrl: z.string().optional(),
      enabled: z.boolean().optional(),
      notifyOn: z.array(z.string()).optional(),
    })
    .optional(),
}).passthrough();

export interface WebhookEntry {
  url: string;
  events: string[];
}

/**
 * Hand-written interface for IntegrationConfig.
 *
 * Intentionally duplicates IntegrationConfigSchema rather than using `z.infer<>`:
 * the Zod schema marks all inner fields as `.optional()` for lenient file parsing,
 * but consumers treat fields as required once an integration object is present.
 * Keeping the explicit interface avoids widening every field to `T | undefined`.
 */
export interface IntegrationConfig {
  slack?: {
    webhookUrl: string;
    enabled: boolean;
    notifyOn: ('passed' | 'failed' | 'all')[];
  };
  jira?: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey: string;
    enabled: boolean;
    autoCreateBugs: boolean;
  };
  github?: {
    token: string;
    owner: string;
    repo: string;
    enabled: boolean;
    prComments: boolean;
    commitStatus: boolean;
    checkRuns?: boolean;
    defaultBaseBranch?: string;
    ignoreFlakyInComments?: boolean;
  };
  gitlab?: {
    token: string;
    projectId: string;
    baseUrl: string;
    enabled: boolean;
    mrComments: boolean;
    defaultBaseBranch?: string;
  };
  webhooks?: WebhookEntry[];
  email?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    recipients: string[];
    enabled: boolean;
  };
  teams?: {
    webhookUrl: string;
    enabled: boolean;
    notifyOn: string[];
  };
}

function ensureDir() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readConfig(): IntegrationConfig {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const parsed = IntegrationConfigSchema.safeParse(raw);
    if (!parsed.success) return {};
    return parsed.data as IntegrationConfig;
  } catch (_err) {
    // Corrupt or unreadable config file — fall back to empty defaults
    return {};
  }
}

export function writeConfig(config: IntegrationConfig) {
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
