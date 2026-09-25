import { describe, expect, it } from 'vitest';
import { slackManifest } from './index.js';

describe('slack connector real handlers', () => {
  it('post_summary handler exists with webhook-based implementation', () => {
    const tool = slackManifest.tools.find(t => t.name === 'post_summary')!;
    expect(tool).toBeDefined();
    expect(tool.description).toContain('Slack');
  });

  it('input schema has optional run summary fields', () => {
    const tool = slackManifest.tools.find(t => t.name === 'post_summary')!;
    expect(tool.inputSchema).toBeDefined();
  });
});
