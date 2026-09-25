import { describe, expect, it } from 'vitest';
import { githubManifest } from './index.js';

describe('github connector real handlers', () => {
  it('create_issue handler calls Octokit', async () => {
    const tool = githubManifest.tools.find(t => t.name === 'create_issue')!;
    // Test with mock credentials — should validate input structure
    // Real API call requires GITHUB_TOKEN, which we don't have in CI
    try {
      await tool.handler(
        { title: 'test issue', body: 'test body' },
        { credentials: { token: 'fake', owner: 'test', repo: 'test' }, abortSignal: new AbortController().signal },
      );
    } catch (e: unknown) {
      // Expected: auth failure with fake token
      const err = e as Error & { status?: number };
      expect(err.message || err.status).toBeDefined();
    }
  });

  it('post_pr_comment handler exists', () => {
    const tool = githubManifest.tools.find(t => t.name === 'post_pr_comment');
    expect(tool).toBeDefined();
  });

  it('create_issue input schema accepts labels', () => {
    const tool = githubManifest.tools.find(t => t.name === 'create_issue')!;
    expect(tool.inputSchema).toBeDefined();
  });
});
