import { z } from 'zod/v4';
import type { ConnectorManifest } from '../../../../packages/connector-sdk/src/types.js';
import { createTraceLink, getTraceLinks } from '../services/traceability.js';

export const traceabilityManifest: ConnectorManifest = {
  name: 'traceability',
  version: '1.0.0',
  displayName: 'Cross-Tool Traceability',
  description: 'Link test results to GitHub PRs, Jira issues, and error clusters. Enables the LLM to answer questions like "What PR introduced this failure?" by tracing test → commit → PR.',
  icon: 'link',
  credentialSchema: z.object({}),
  tools: [
    {
      name: 'get_trace',
      description: 'Get all artifacts linked to a given source (test stableId, commit SHA, run ID). Returns linked PRs, Jira issues, error clusters, and other connected artifacts.',
      inputSchema: z.object({
        sourceType: z.string().describe('Type: "test", "commit", "run", "jira_issue", "pr"'),
        sourceId: z.string().min(1).describe('The ID of the source artifact'),
      }),
      handler: async (input, _ctx) => {
        const parsed = z.object({
          sourceType: z.string(),
          sourceId: z.string().min(1),
        }).safeParse(input);

        if (!parsed.success) {
          return {
            content: [{ type: 'text' as const, text: 'Error: sourceType and sourceId are required' }],
            isError: true,
          };
        }

        const { sourceType, sourceId } = parsed.data;
        const links = await getTraceLinks(sourceType, sourceId);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ sourceType, sourceId, links, count: links.length }),
          }],
          isError: false,
        };
      },
    },
    {
      name: 'link_artifacts',
      description: 'Create a trace link between two artifacts (e.g., test failure → Jira ticket, commit → GitHub PR). Use when the user asks to link items or when auto-discovery finds a connection.',
      inputSchema: z.object({
        sourceType: z.string(),
        sourceId: z.string().min(1),
        targetType: z.string(),
        targetId: z.string().min(1),
        linkType: z.string().default('related').describe('Link type: "related", "caused-by", "fixed-by", "reported-as"'),
        metadata: z.string().optional().describe('JSON metadata about the link'),
      }),
      handler: async (input, _ctx) => {
        const parsed = z.object({
          sourceType: z.string(),
          sourceId: z.string().min(1),
          targetType: z.string(),
          targetId: z.string().min(1),
          linkType: z.string().default('related'),
          metadata: z.string().optional(),
        }).safeParse(input);

        if (!parsed.success) {
          return {
            content: [{ type: 'text' as const, text: 'Error: sourceType, sourceId, targetType, and targetId are required' }],
            isError: true,
          };
        }

        const { sourceType, sourceId, targetType, targetId, linkType, metadata } = parsed.data;
        const link = await createTraceLink({ sourceType, sourceId, targetType, targetId, linkType, metadata });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ linked: true, id: link.id }),
          }],
          isError: false,
        };
      },
    },
  ],
};
