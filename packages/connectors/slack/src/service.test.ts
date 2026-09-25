import { describe, expect, it } from 'vitest';
import { buildSlackBlocks } from './service.js';

describe('buildSlackBlocks', () => {
  it('returns block kit payload with header first', () => {
    const blocks = buildSlackBlocks({
      runId: '1234567890abcdef',
      status: 'passed',
      total: 12,
      passed: 11,
      failed: 1,
      flaky: 0,
      skipped: 0,
      durationMs: 12_000,
      branch: 'main',
    });

    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks[0]).toMatchObject({ type: 'header' });
  });

  it('includes summary section with fields', () => {
    const blocks = buildSlackBlocks({
      runId: 'abcdef1234567890',
      status: 'failed',
      total: 20,
      passed: 18,
      failed: 2,
      flaky: 0,
      skipped: 0,
      dashboardUrl: 'https://example.com/run/2',
    });

    const sectionWithFields = blocks.find(
      (block: { type: string } & Record<string, unknown>) => block.type === 'section' && 'fields' in block,
    ) as { fields: unknown[] } | undefined;

    expect(sectionWithFields).toBeDefined();
    expect(sectionWithFields?.fields.length).toBeGreaterThan(0);
  });
});
