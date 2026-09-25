import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { PactV4 } from '@pact-foundation/pact';
import type { ToolContext } from '@automate/connector-sdk';
import { githubManifest } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pact = new PactV4({
  consumer: 'Automate',
  provider: 'GitHubAPI',
  dir: path.resolve(__dirname, '../../../../../pacts'),
});

function getTool(name: 'create_issue' | 'post_pr_comment') {
  const tool = githubManifest.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function makeCtx(baseUrl: string): ToolContext {
  return {
    credentials: {
      token: 'ghp_test_token',
      owner: 'test-owner',
      repo: 'test-repo',
      baseUrl,
    },
    abortSignal: new AbortController().signal,
  };
}

describe('GitHub connector Pact tests', () => {
  it('create_issue — POST /repos/{owner}/{repo}/issues', async () => {
    await pact
      .addInteraction()
      .given('a GitHub repo exists')
      .uponReceiving('a request to create an issue')
      .withRequest('POST', '/repos/test-owner/test-repo/issues', (builder) => {
        builder
          .headers({ 'Content-Type': 'application/json; charset=utf-8' })
          .jsonBody({
            title: 'Pact test issue',
            body: 'Created by Pact consumer test',
            labels: undefined,
          });
      })
      .willRespondWith(201, (builder) => {
        builder.jsonBody({
          id: 1,
          number: 42,
          title: 'Pact test issue',
          state: 'open',
          html_url: 'https://github.com/test-owner/test-repo/issues/42',
        });
      })
      .executeTest(async (mockService) => {
        const ctx = makeCtx(mockService.url);
        const tool = getTool('create_issue');
        const result = await tool.handler(
          { title: 'Pact test issue', body: 'Created by Pact consumer test' },
          ctx,
        );
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('#42');
      });
  });

  it('post_pr_comment — POST /repos/{owner}/{repo}/issues/{number}/comments', async () => {
    await pact
      .addInteraction()
      .given('a GitHub PR exists with number 7')
      .uponReceiving('a request to post a PR comment')
      .withRequest('POST', '/repos/test-owner/test-repo/issues/7/comments', (builder) => {
        builder
          .headers({ 'Content-Type': 'application/json; charset=utf-8' })
          .jsonBody({ body: 'LGTM from Pact' });
      })
      .willRespondWith(201, (builder) => {
        builder.jsonBody({
          id: 101,
          body: 'LGTM from Pact',
          created_at: '2026-01-01T00:00:00Z',
          html_url: 'https://github.com/test-owner/test-repo/issues/7#issuecomment-101',
        });
      })
      .executeTest(async (mockService) => {
        const ctx = makeCtx(mockService.url);
        const tool = getTool('post_pr_comment');
        const result = await tool.handler(
          { pull_number: 7, body: 'LGTM from Pact' },
          ctx,
        );
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('issuecomment-101');
      });
  });
});
