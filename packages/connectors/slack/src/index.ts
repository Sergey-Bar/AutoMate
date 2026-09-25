import { z } from 'zod/v4';
import type { ConnectorManifest, ToolContext } from '@automate/connector-sdk';
import { createConnectorLimiter, createResiliencePolicy } from '@automate/connector-sdk';
import { buildSlackBlocks } from './service.js';

const limiter = createConnectorLimiter({ maxConcurrent: 1, minTime: 1000 });
const policy = createResiliencePolicy();

export const slackManifest: ConnectorManifest = {
  name: 'slack',
  version: '0.1.0',
  displayName: 'Slack',
  description: 'Slack MCP connector — post QA summaries via webhook',
  icon: 'slack',
  credentialSchema: z.object({ webhookUrl: z.url() }),
  tools: [
    {
      name: 'post_summary',
      description: 'Post a QA test summary to a Slack channel via webhook',
      inputSchema: z.object({
        text: z.string().describe('Plain text summary'),
        runId: z.string().optional(),
        status: z.string().optional(),
        total: z.number().optional(),
        passed: z.number().optional(),
        failed: z.number().optional(),
        flaky: z.number().optional(),
        skipped: z.number().optional(),
      }),
      handler: async (input: unknown, ctx: ToolContext) => {
        const data = input as { text: string; runId?: string; status?: string; total?: number; passed?: number; failed?: number; flaky?: number; skipped?: number };
        const { webhookUrl } = ctx.credentials;
        const blocks = data.runId
          ? buildSlackBlocks({ runId: data.runId, status: data.status ?? 'unknown', total: data.total ?? 0, passed: data.passed ?? 0, failed: data.failed ?? 0, flaky: data.flaky ?? 0, skipped: data.skipped ?? 0 })
          : [{ type: 'section' as const, text: { type: 'mrkdwn' as const, text: data.text } }];

        const res = await limiter.schedule(() =>
          policy.execute(async () =>
            fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ blocks }),
              signal: ctx.abortSignal,
            })
          )
        );

        if (!res.ok) {
          return { content: [{ type: 'text' as const, text: `Slack webhook failed: ${res.status} ${res.statusText}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: 'Posted summary to Slack' }] };
      },
    },
  ],
};

export * from './service.js';
