import { z } from 'zod/v4';
import type { ConnectorManifest } from '../../../../packages/connector-sdk/src/types.js';
import { createDashboardMcpClient } from './mcp-client.js';

export const gateOrchestratorManifest: ConnectorManifest = {
  name: 'gate_orchestrator',
  version: '1.0.0',
  displayName: 'Quality Gate Orchestrator',
  description: 'Check Dashboard quality gate status via MCP. Calls the Dashboard MCP server to retrieve gate evaluation results for a given test run.',
  icon: 'gate',
  credentialSchema: z.object({}),
  tools: [
    {
      name: 'check_quality_gate',
      description: [
        'Check the quality gate status for a specific test run.',
        'Returns whether the gate passed or failed, the pass rate achieved vs. the configured threshold,',
        'the number of failed tests, and the total test count.',
        'Use this when asked about CI gate status, quality gate results, or whether a run meets thresholds.',
      ].join(' '),
      inputSchema: z.object({
        runId: z.string().min(1).describe('The test run ID to check the quality gate for'),
      }),
      handler: async (input, _ctx) => {
        const parsed = z.object({ runId: z.string().min(1) }).safeParse(input);
        if (!parsed.success) {
          return {
            content: [{ type: 'text' as const, text: 'Error: runId is required and must be a non-empty string' }],
            isError: true,
          };
        }

        const { runId } = parsed.data;
        const client = createDashboardMcpClient();

        try {
          await client.connect();
          return await client.callTool('runs.get_gate_status', { runId });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{
              type: 'text' as const,
              text: `Quality gate check failed: ${message}. Ensure the Dashboard is running and DASHBOARD_MCP_URL/DASHBOARD_MCP_API_KEY are configured.`,
            }],
            isError: true,
          };
        } finally {
          await client.disconnect();
        }
      },
    },
  ],
};
