import { z } from 'zod/v4';
import {
  HealthFindingSchema,
  HealthFindingsPageSchema,
  HealthHistorySchema,
  HealthScanStartedSchema,
  PortfolioSchema,
  ProjectHealthSchema,
  type FindingSeverity,
  type FindingState,
  type HealthDimension,
  type HealthFinding,
  type HealthFindingsPage,
  type HealthHistory,
  type HealthScanStarted,
  type Portfolio,
  type ProjectHealth,
  type TriageFindingBody,
} from '@automate/shared-contracts';
import { parse } from './qa-client.js';

/**
 * The repository health data layer.
 *
 * Same two rules as `qa-client.ts`: every response is parsed against the server's own
 * contract, and every path is built here, so no screen concatenates a project id into a URL.
 */
export interface FindingQuery {
  dimension?: HealthDimension | undefined;
  severity?: FindingSeverity | undefined;
  state?: FindingState | undefined;
  tool?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface HealthClient {
  getPortfolio(): Promise<Portfolio>;
  getHealth(projectId: string): Promise<ProjectHealth>;
  getFindings(projectId: string, query?: FindingQuery): Promise<HealthFindingsPage>;
  getHistory(projectId: string, days: number): Promise<HealthHistory>;
  triage(projectId: string, findingId: string, body: TriageFindingBody): Promise<HealthFinding>;
  /** Runs the repository's health scanners. A command id list never leaves the server. */
  startScan(projectId: string): Promise<HealthScanStarted>;
  whoami(): Promise<WhoAmI>;
  /** Signs this browser in with an access token, or with the installation key. */
  signIn(credential: string): Promise<void>;
  signOut(): Promise<void>;
  listTokens(): Promise<AccessTokenSummary[]>;
  createToken(body: {
    name: string;
    role: TokenRole;
    projectId?: string;
  }): Promise<{ token: string; summary: AccessTokenSummary }>;
  revokeToken(id: string): Promise<AccessTokenSummary>;
  getSettings(projectId: string): Promise<HealthSettings>;
  setSchedule(
    projectId: string,
    cadence: 'daily' | 'weekly' | null,
  ): Promise<{ cadence: 'daily' | 'weekly' | null; scanners: string[] }>;
  setAlerts(
    projectId: string,
    alerts: { slackChannel?: string | null; webhookUrl?: string | null },
  ): Promise<void>;
}

export const HealthSettingsSchema = z.object({
  alerts: z.object({
    slackChannel: z.string().nullable().optional(),
    webhookUrl: z.string().nullable().optional(),
  }),
  schedule: z.enum(['daily', 'weekly']).nullable(),
  codeowners: z.boolean(),
});
export type HealthSettings = z.infer<typeof HealthSettingsSchema>;

export const WhoAmISchema = z.object({
  actor: z.string(),
  role: z.enum(['viewer', 'operator', 'admin']).nullable(),
  mode: z.enum(['open', 'enforced']),
});
export type WhoAmI = z.infer<typeof WhoAmISchema>;

export const TOKEN_ROLES = ['viewer', 'operator', 'admin', 'uploader'] as const;
export type TokenRole = (typeof TOKEN_ROLES)[number];

export const AccessTokenSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(TOKEN_ROLES),
  projectId: z.string().nullable(),
  displayPrefix: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type AccessTokenSummary = z.infer<typeof AccessTokenSummarySchema>;

function search(query: FindingQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text.length === 0 ? '' : `?${text}`;
}

export function createHealthClient(baseUrl = '', fetchImpl: typeof fetch = fetch): HealthClient {
  const project = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}`;

  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      credentials: 'include',
      method: 'GET',
    });
    return parse(response, schema, path);
  }

  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parse(response, schema, path);
  }

  async function put<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      credentials: 'include',
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parse(response, schema, path);
  }

  return {
    getPortfolio: () => get('/api/v1/portfolio', PortfolioSchema),
    getHealth: (projectId) => get(`${project(projectId)}/health`, ProjectHealthSchema),
    getFindings: (projectId, query = {}) =>
      get(`${project(projectId)}/health/findings${search(query)}`, HealthFindingsPageSchema),
    getHistory: (projectId, days) =>
      get(
        `${project(projectId)}/health/history?days=${String(Math.trunc(days))}`,
        HealthHistorySchema,
      ),
    triage: (projectId, findingId, body) =>
      post(
        `${project(projectId)}/health/findings/${encodeURIComponent(findingId)}/triage`,
        body,
        HealthFindingSchema,
      ),
    startScan: (projectId) =>
      post(`${project(projectId)}/health/scan`, {}, HealthScanStartedSchema),
    whoami: () => get('/api/v1/auth/whoami', WhoAmISchema),
    // A token from an admin starts with the access-token prefix; anything else is the
    // installation key, which signs in as the admin through the existing login.
    signIn: async (credential) => {
      const trimmed = credential.trim();
      if (trimmed.startsWith('amt_')) {
        await post('/api/v1/auth/token-login', { token: trimmed }, z.object({}).passthrough());
      } else {
        await post('/api/v1/auth/login', { apiKey: trimmed }, z.object({}).passthrough());
      }
    },
    signOut: async () => {
      await post('/api/v1/auth/token-logout', {}, z.object({}).passthrough());
      await post('/api/v1/auth/logout', {}, z.object({}).passthrough()).catch(() => undefined);
    },
    listTokens: async () =>
      (await get('/api/v1/access-tokens', z.object({ tokens: z.array(AccessTokenSummarySchema) })))
        .tokens,
    createToken: (body) =>
      post(
        '/api/v1/access-tokens',
        body,
        z.object({ token: z.string(), summary: AccessTokenSummarySchema }),
      ),
    getSettings: (projectId) => get(`${project(projectId)}/health/settings`, HealthSettingsSchema),
    setSchedule: (projectId, cadence) =>
      put(
        `${project(projectId)}/health/schedule`,
        { cadence },
        z.object({
          cadence: z.enum(['daily', 'weekly']).nullable(),
          scanners: z.array(z.string()),
        }),
      ),
    setAlerts: async (projectId, alerts) => {
      await put(`${project(projectId)}/health/alerts`, alerts, z.object({}).passthrough());
    },
    revokeToken: async (id) => {
      const path = `/api/v1/access-tokens/${encodeURIComponent(id)}`;
      const response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        method: 'DELETE',
      });
      return parse(response, AccessTokenSummarySchema, path);
    },
  };
}
