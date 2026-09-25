import { z } from 'zod/v4';
import type { ConnectorManifest, ToolContext } from '@automate/connector-sdk';
import { createConnectorLimiter, createResiliencePolicy } from '@automate/connector-sdk';

const limiter = createConnectorLimiter({ maxConcurrent: 3, minTime: 200 });
const policy = createResiliencePolicy();

function jiraFetch(ctx: ToolContext, path: string, options: RequestInit = {}): Promise<Response> {
  const { baseUrl, email, apiToken } = ctx.credentials;
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  return limiter.schedule(() =>
    policy.execute(async () =>
      fetch(`${baseUrl}/rest/api/3${path}`, {
        ...options,
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers,
        },
        signal: ctx.abortSignal,
      })
    )
  );
}

export const jiraManifest: ConnectorManifest = {
  name: 'jira',
  version: '0.1.0',
  displayName: 'Jira',
  description: 'Jira MCP connector — create issues, search with JQL',
  icon: 'jira',
  credentialSchema: z.object({ baseUrl: z.url(), email: z.email(), apiToken: z.string(), projectKey: z.string() }),
  tools: [
    {
      name: 'create_issue',
      description: 'Create a Jira issue',
      inputSchema: z.object({ summary: z.string(), description: z.string(), issueType: z.string().default('Bug') }),
      handler: async (input: unknown, ctx: ToolContext) => {
        try {
          const { summary, description, issueType } = input as { summary: string; description: string; issueType: string };
          const res = await jiraFetch(ctx, '/issue', {
            method: 'POST',
            body: JSON.stringify({
              fields: {
                project: { key: ctx.credentials.projectKey },
                summary,
                description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] },
                issuetype: { name: issueType },
              },
            }),
          });
          if (!res.ok) {
            const errorText = await res.text();
            return { content: [{ type: 'text' as const, text: `Jira API error ${res.status}: ${errorText}` }], isError: true };
          }
          const data = await res.json() as { key: string };
          return { content: [{ type: 'text' as const, text: `Created ${data.key}: ${ctx.credentials.baseUrl}/browse/${data.key}` }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: `create_issue failed: ${(err as Error).message}` }], isError: true };
        }
      },
    },
    {
      name: 'search_issues',
      description: 'Search Jira issues using JQL',
      inputSchema: z.object({ jql: z.string(), maxResults: z.number().default(10) }),
      handler: async (input: unknown, ctx: ToolContext) => {
        try {
          const { jql, maxResults } = input as { jql: string; maxResults: number };
          const res = await jiraFetch(ctx, `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`);
          if (!res.ok) {
            const errorText = await res.text();
            return { content: [{ type: 'text' as const, text: `Jira API error ${res.status}: ${errorText}` }], isError: true };
          }
          const data = await res.json() as { issues?: Array<{ key: string; fields?: { summary?: string } }> };
          const issues = (data.issues ?? []).map((i) => `${i.key}: ${i.fields?.summary}`).join('\n');
          return { content: [{ type: 'text' as const, text: issues || 'No issues found' }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: `search_issues failed: ${(err as Error).message}` }], isError: true };
        }
      },
    },
  ],
};

export * from './service.js';
