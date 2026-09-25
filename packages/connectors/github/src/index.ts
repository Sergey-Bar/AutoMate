import { z } from 'zod/v4';
import { Octokit } from '@octokit/rest';
import type { ConnectorManifest, ToolContext } from '@automate/connector-sdk';
import { createConnectorLimiter, createResiliencePolicy, classifyHttpError } from '@automate/connector-sdk';

const limiter = createConnectorLimiter({ maxConcurrent: 5, minTime: 100 });
const policy = createResiliencePolicy();

function getOctokit(ctx: ToolContext) {
  const baseUrl = ctx.credentials.baseUrl;
  return new Octokit({ auth: ctx.credentials.token, ...(baseUrl ? { baseUrl } : {}) });
}

async function githubRequest<T>(fn: () => Promise<T>): Promise<T> {
  return limiter.schedule(() =>
    policy.execute(async () => {
      try {
        return await fn();
      } catch (err) {
        throw classifyHttpError(err);
      }
    })
  );
}

export const githubManifest: ConnectorManifest = {
  name: 'github',
  version: '0.1.0',
  displayName: 'GitHub',
  description: 'GitHub MCP connector — create issues, comment on PRs',
  icon: 'github',
  credentialSchema: z.object({ token: z.string(), owner: z.string(), repo: z.string(), baseUrl: z.string().optional() }),
  tools: [
    {
      name: 'create_issue',
      description: 'Create a GitHub issue in the configured repository',
      inputSchema: z.object({ title: z.string(), body: z.string(), labels: z.array(z.string()).optional() }),
      handler: async (input: unknown, ctx: ToolContext) => {
        try {
          const { title, body, labels } = input as { title: string; body: string; labels?: string[] };
          const octokit = getOctokit(ctx);
          const { owner, repo } = ctx.credentials;
          const issue = await githubRequest(() =>
            octokit.issues.create({
              owner, repo,
              title,
              body,
              labels,
            })
          );
          return { content: [{ type: 'text' as const, text: `Created issue #${issue.data.number}: ${issue.data.html_url}` }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true };
        }
      },
    },
    {
      name: 'post_pr_comment',
      description: 'Post a review comment on a pull request',
      inputSchema: z.object({ pull_number: z.number(), body: z.string() }),
      handler: async (input: unknown, ctx: ToolContext) => {
        try {
          const { pull_number, body } = input as { pull_number: number; body: string };
          const octokit = getOctokit(ctx);
          const { owner, repo } = ctx.credentials;
          const comment = await githubRequest(() =>
            octokit.issues.createComment({
              owner, repo,
              issue_number: pull_number,
              body,
            })
          );
          return { content: [{ type: 'text' as const, text: `Posted comment: ${comment.data.html_url}` }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true };
        }
      },
    },
  ],
};

export * from './service.js';
