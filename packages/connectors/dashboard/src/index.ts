import { z } from 'zod/v4';
import type { ConnectorManifest, ToolContext } from '@automate/connector-sdk';

function getDashboardUrl(ctx: ToolContext): string {
  return ctx.credentials.dashboardUrl || process.env.DASHBOARD_URL || 'http://localhost:4000';
}

function getServiceSecret(ctx: ToolContext): string {
  return ctx.credentials.serviceSecret || process.env.AUTOMATE_SERVICE_SECRET || '';
}

async function dashboardFetch(url: string, ctx: ToolContext, options: RequestInit = {}): Promise<Response> {
  const secret = getServiceSecret(ctx);
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Auth': `Bearer ${secret}`,
      ...(options.headers as Record<string, string> | undefined),
    },
    signal: ctx.abortSignal,
  });
}

export const dashboardManifest: ConnectorManifest = {
  name: 'dashboard',
  version: '0.1.0',
  displayName: 'Dashboard',
  description: 'Automate connector — trigger test runs, get results',
  icon: 'test-tube',
  credentialSchema: z.object({
    dashboardUrl: z.string().optional(),
    serviceSecret: z.string().optional(),
  }),
  tools: [
    {
      name: 'triggerTestRun',
      description: 'Trigger a Playwright test run on the Dashboard. Provide the test spec code and filename.',
      inputSchema: z.object({
        specCode: z.string().describe('The Playwright test code to execute'),
        specFileName: z.string().describe('Filename for the test spec (e.g. "login.spec.ts")'),
        baseUrl: z.string().optional().describe('Base URL for the tests'),
        browser: z.enum(['chromium', 'firefox', 'webkit']).optional().describe('Browser to use'),
      }),
      handler: async (input: unknown, ctx: ToolContext) => {
        try {
          const { specCode, specFileName, baseUrl, browser } = input as {
            specCode: string;
            specFileName: string;
            baseUrl?: string;
            browser?: string;
          };
          const dashboardUrl = getDashboardUrl(ctx);
          const res = await dashboardFetch(`${dashboardUrl}/api/service/trigger-run`, ctx, {
            method: 'POST',
            body: JSON.stringify({ specCode, specFileName, baseUrl, browser }),
          });
          if (!res.ok) {
            const body = await res.text();
            return {
              content: [{ type: 'text' as const, text: `Failed to trigger run: ${res.status} ${body}` }],
              isError: true,
            };
          }
          const data = await res.json() as { runId: string; status: string };
          return {
            content: [{ type: 'text' as const, text: `Test run triggered. Run ID: ${data.runId}, Status: ${data.status}` }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Dashboard unreachable: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    },
    {
      name: 'getRunStatus',
      description: 'Get the status of a test run by its ID',
      inputSchema: z.object({
        runId: z.string().describe('The run ID to check'),
      }),
      handler: async (input: unknown, ctx: ToolContext) => {
        try {
          const { runId } = input as { runId: string };
          const dashboardUrl = getDashboardUrl(ctx);
          const res = await dashboardFetch(`${dashboardUrl}/api/runs/${runId}`, ctx);
          if (!res.ok) {
            return {
              content: [{ type: 'text' as const, text: `Run not found: ${res.status}` }],
              isError: true,
            };
          }
          const data = await res.json() as Record<string, unknown>;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Dashboard unreachable: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    },
    {
      name: 'getRunResults',
      description: 'Get detailed test results for a completed run',
      inputSchema: z.object({
        runId: z.string().describe('The run ID to get results for'),
      }),
      handler: async (input: unknown, ctx: ToolContext) => {
        try {
          const { runId } = input as { runId: string };
          const dashboardUrl = getDashboardUrl(ctx);
          const res = await dashboardFetch(`${dashboardUrl}/api/runs/${runId}/tests`, ctx);
          if (!res.ok) {
            return {
              content: [{ type: 'text' as const, text: `Results not found: ${res.status}` }],
              isError: true,
            };
          }
          const data = await res.json() as Record<string, unknown>;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Dashboard unreachable: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    },
    {
      name: 'listRecentRuns',
      description: 'List recent test runs from the Dashboard',
      inputSchema: z.object({
        limit: z.number().optional().describe('Maximum number of runs to return (default: 10)'),
      }),
      handler: async (input: unknown, ctx: ToolContext) => {
        try {
          const { limit = 10 } = input as { limit?: number };
          const dashboardUrl = getDashboardUrl(ctx);
          const res = await dashboardFetch(`${dashboardUrl}/api/runs?limit=${limit}`, ctx);
          if (!res.ok) {
            return {
              content: [{ type: 'text' as const, text: `Failed to list runs: ${res.status}` }],
              isError: true,
            };
          }
          const data = await res.json() as Record<string, unknown>;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Dashboard unreachable: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    },
  ],
};
