import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { PactV4 } from '@pact-foundation/pact';
import type { ToolContext } from '@automate/connector-sdk';
import { jiraManifest } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pact = new PactV4({
  consumer: 'Automate',
  provider: 'JiraAPI',
  dir: path.resolve(__dirname, '../../../../../pacts'),
});

function getTool(name: 'create_issue' | 'search_issues') {
  const tool = jiraManifest.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function makeCtx(baseUrl: string): ToolContext {
  return {
    credentials: {
      baseUrl,
      email: 'test@example.com',
      apiToken: 'test-api-token',
      projectKey: 'TEST',
    },
    abortSignal: new AbortController().signal,
  };
}

describe('Jira connector Pact tests', () => {
  it('create_issue — POST /rest/api/3/issue', async () => {
    await pact
      .addInteraction()
      .given('a Jira project TEST exists')
      .uponReceiving('a request to create a Jira issue')
      .withRequest('POST', '/rest/api/3/issue', (builder) => {
        builder
          .headers({ 'Content-Type': 'application/json' })
          .jsonBody({
            fields: {
              project: { key: 'TEST' },
              summary: 'Pact test issue',
              description: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Created by Pact' }] }],
              },
              issuetype: { name: 'Bug' },
            },
          });
      })
      .willRespondWith(201, (builder) => {
        builder.jsonBody({
          id: '10001',
          key: 'TEST-1',
          self: 'http://localhost/rest/api/3/issue/10001',
        });
      })
      .executeTest(async (mockService) => {
        const ctx = makeCtx(mockService.url);
        const tool = getTool('create_issue');
        const result = await tool.handler(
          { summary: 'Pact test issue', description: 'Created by Pact', issueType: 'Bug' },
          ctx,
        );
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('TEST-1');
      });
  });

  it('search_issues — GET /rest/api/3/search (via query param)', async () => {
    await pact
      .addInteraction()
      .given('some Jira issues exist in project TEST')
      .uponReceiving('a request to search Jira issues by JQL')
      .withRequest('GET', '/rest/api/3/search', (builder) => {
        builder.query({ jql: 'project=TEST', maxResults: '10' });
      })
      .willRespondWith(200, (builder) => {
        builder.jsonBody({
          issues: [
            { key: 'TEST-1', fields: { summary: 'First issue' } },
            { key: 'TEST-2', fields: { summary: 'Second issue' } },
          ],
          total: 2,
          maxResults: 10,
        });
      })
      .executeTest(async (mockService) => {
        const ctx = makeCtx(mockService.url);
        const tool = getTool('search_issues');
        const result = await tool.handler(
          { jql: 'project=TEST', maxResults: 10 },
          ctx,
        );
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('TEST-1');
        expect(result.content[0].text).toContain('TEST-2');
      });
  });
});
