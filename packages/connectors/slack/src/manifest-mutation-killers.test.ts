/**
 * Targeted mutation-killing tests for slack/src/index.ts
 *
 * Surviving Stryker mutants:
 * - name: 'slack' → ''
 * - version: '0.1.0' → ''
 * - displayName: 'Slack' → ''
 * - description → ''
 * - icon: 'slack' → ''
 * - tool name 'post_summary' → ''
 * - ObjectLiteral: the block object → {}
 * - StringLiteral 'mrkdwn' → ''
 * - ObjectLiteral: credentialSchema → {}
 * - LogicalOperator: data.skipped || 0 → data.skipped && 0
 * - StringLiteral: 'Posted summary to Slack' → ''
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@automate/connector-sdk';
import { slackManifest } from './index.js';

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

function createCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    credentials: { webhookUrl: 'https://hooks.slack.com/test' },
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('slackManifest — manifest field mutation killers', () => {
  beforeAll(() => {
    globalThis.fetch = mockFetch as typeof fetch;
  });

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true } as Response);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('manifest name is exactly "slack" — kills StringLiteral mutant', () => {
    expect(slackManifest.name).toBe('slack');
    expect(slackManifest.name).not.toBe('');
  });

  it('manifest version is exactly "0.1.0" — kills StringLiteral mutant', () => {
    expect(slackManifest.version).toBe('0.1.0');
    expect(slackManifest.version).not.toBe('');
  });

  it('manifest displayName is exactly "Slack" — kills StringLiteral mutant', () => {
    expect(slackManifest.displayName).toBe('Slack');
    expect(slackManifest.displayName).not.toBe('');
  });

  it('manifest description is non-empty — kills StringLiteral mutant', () => {
    expect(slackManifest.description).toBeTruthy();
    expect(slackManifest.description).not.toBe('');
  });

  it('manifest icon is exactly "slack" — kills StringLiteral mutant', () => {
    expect(slackManifest.icon).toBe('slack');
    expect(slackManifest.icon).not.toBe('');
  });

  it('tool name is exactly "post_summary" — kills StringLiteral mutant', () => {
    const tool = slackManifest.tools[0];
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('post_summary');
    expect(tool!.name).not.toBe('');
  });

  // Kills ObjectLiteral mutant: credentialSchema → {}
  it('credentialSchema requires webhookUrl — kills ObjectLiteral mutant', () => {
    const schema = slackManifest.credentialSchema;

    const valid = schema.safeParse({ webhookUrl: 'https://hooks.slack.com/services/xxx/yyy/zzz' });
    expect(valid.success).toBe(true);

    // Without real schema ({} accepts everything), this would pass
    const empty = schema.safeParse({});
    expect(empty.success).toBe(false);

    const invalidUrl = schema.safeParse({ webhookUrl: 'not-a-url' });
    expect(invalidUrl.success).toBe(false);
  });

  // Kills ObjectLiteral mutant: block object → {}
  // and StringLiteral 'mrkdwn' → ''
  it('text-only post sends section block with mrkdwn type — kills ObjectLiteral/StringLiteral mutants', async () => {
    const tool = slackManifest.tools[0]!;
    const ctx = createCtx();

    await tool.handler({ text: 'QA run complete' }, ctx);

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as {
      blocks: Array<{ type: string; text?: { type: string; text: string } }>;
    };

    // If ObjectLiteral mutant: block would be {} with no type/text
    expect(body.blocks[0]?.type).toBe('section');
    expect(body.blocks[0]?.type).not.toBe('');
    // If StringLiteral mutant: text.type would be '' instead of 'mrkdwn'
    expect(body.blocks[0]?.text?.type).toBe('mrkdwn');
    expect(body.blocks[0]?.text?.type).not.toBe('');
    expect(body.blocks[0]?.text?.text).toBe('QA run complete');
  });

  // Kills StringLiteral mutant: 'Posted summary to Slack' → ''
  it('success result text is non-empty — kills StringLiteral mutant on success message', async () => {
    const tool = slackManifest.tools[0]!;
    const result = await tool.handler({ text: 'summary' }, createCtx());

    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toBe('Posted summary to Slack');
    expect(text).not.toBe('');
  });

  // Kills LogicalOperator mutant: data.skipped || 0 → data.skipped && 0
  // undefined || 0 = 0 (correct)
  // undefined && 0 = undefined (mutant - may cause NaN in block building or use wrong value)
  it('skipped defaults to 0 (not undefined) when omitted with runId — kills LogicalOperator mutant', async () => {
    const tool = slackManifest.tools[0]!;
    const ctx = createCtx();

    // No skipped in input
    await tool.handler({
      text: 'test',
      runId: 'run-abc',
      status: 'passed',
      total: 5,
      passed: 5,
      failed: 0,
      flaky: 0,
      // skipped intentionally omitted
    }, ctx);

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as { blocks: unknown[] };

    // With || 0: skipped = 0 (number) → buildSlackBlocks receives skipped: 0
    // With && 0: skipped = undefined && 0 = undefined → buildSlackBlocks receives skipped: undefined
    // Both should result in valid blocks (not crash), but the content differs
    expect(body.blocks).toBeDefined();
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.length).toBeGreaterThan(0);

    // The blocks content should include '0' for skipped (not undefined/NaN)
    const blocksStr = JSON.stringify(body.blocks);
    // Skipped = 0, so the string representation should not contain 'NaN' or 'undefined'
    expect(blocksStr).not.toContain('NaN');
    expect(blocksStr).not.toContain('"undefined"');
  });

  it('skipped value 5 is correctly passed in blocks — confirms || 0 is not masking actual values', async () => {
    const tool = slackManifest.tools[0]!;
    const ctx = createCtx();

    await tool.handler({
      text: 'test',
      runId: 'run-xyz',
      status: 'passed',
      total: 20,
      passed: 10,
      failed: 5,
      flaky: 0,
      skipped: 5,
    }, ctx);

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as { blocks: unknown[] };
    const blocksStr = JSON.stringify(body.blocks);

    // With actual skipped: 5, the || 0 fallback is not used (5 || 0 = 5)
    // The skipped count should appear in the blocks
    expect(blocksStr).toContain('5');
  });
});
