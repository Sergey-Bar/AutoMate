import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { PactV4 } from '@pact-foundation/pact';
import type { ToolContext } from '@automate/connector-sdk';
import { slackManifest } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pact = new PactV4({
  consumer: 'Automate',
  provider: 'SlackWebhookAPI',
  dir: path.resolve(__dirname, '../../../../../pacts'),
});

function getTool(name: 'post_summary') {
  const tool = slackManifest.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function makeCtx(webhookUrl: string): ToolContext {
  return {
    credentials: { webhookUrl },
    abortSignal: new AbortController().signal,
  };
}

describe('Slack connector Pact tests', () => {
  it('post_summary success — POST / returns 200 ok', async () => {
    await pact
      .addInteraction()
      .given('the Slack webhook is valid')
      .uponReceiving('a request to post a QA summary to Slack')
      .withRequest('POST', '/', (builder) => {
        builder
          .headers({ 'Content-Type': 'application/json' })
          .jsonBody({
            blocks: [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: 'All tests passed' },
              },
            ],
          });
      })
      .willRespondWith(200, (builder) => {
        builder.body('text/plain', Buffer.from('ok'));
      })
      .executeTest(async (mockService) => {
        const ctx = makeCtx(mockService.url);
        const tool = getTool('post_summary');
        const result = await tool.handler({ text: 'All tests passed' }, ctx);
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toBe('Posted summary to Slack');
      });
  });

  it('post_summary error — POST / with invalid webhook returns 400', async () => {
    await pact
      .addInteraction()
      .given('the Slack webhook is invalid')
      .uponReceiving('a request to post to an invalid Slack webhook')
      .withRequest('POST', '/', (builder) => {
        builder
          .headers({ 'Content-Type': 'application/json' })
          .jsonBody({
            blocks: [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: 'Test run failed: 3 errors' },
              },
            ],
          });
      })
      .willRespondWith(400, (builder) => {
        builder.body('text/plain', Buffer.from('invalid_payload'));
      })
      .executeTest(async (mockService) => {
        const ctx = makeCtx(mockService.url);
        const tool = getTool('post_summary');
        const result = await tool.handler({ text: 'Test run failed: 3 errors' }, ctx);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Slack webhook failed: 400');
      });
  });
});
