import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@automate/connector-sdk';

const mockCreate = vi.fn();
const mockCreateComment = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function OctokitMock() {
    return {
      issues: {
        create: mockCreate,
        createComment: mockCreateComment,
      },
    };
  }),
}));

import { Octokit } from '@octokit/rest';
import { githubManifest } from './index.js';

function createCtx(overrides?: Partial<Record<string, string>>): ToolContext {
  return {
    credentials: {
      token: 'ghp_test123',
      owner: 'test-owner',
      repo: 'test-repo',
      ...overrides,
    },
    abortSignal: new AbortController().signal,
  };
}

function getTool(name: 'create_issue' | 'post_pr_comment') {
  const tool = githubManifest.tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

describe('githubManifest', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreateComment.mockReset();
    vi.mocked(Octokit).mockClear();
  });

  it('exposes create_issue and post_pr_comment tools', () => {
    const toolNames = githubManifest.tools.map((tool) => tool.name);
    expect(toolNames).toContain('create_issue');
    expect(toolNames).toContain('post_pr_comment');
  });

  it('contains exactly two tools', () => {
    expect(githubManifest.tools).toHaveLength(2);
  });

  it('create_issue handler calls octokit.issues.create with owner, repo, title, body, labels', async () => {
    mockCreate.mockResolvedValueOnce({
      data: {
        number: 42,
        html_url: 'https://github.com/test-owner/test-repo/issues/42',
      },
    });

    const createIssueTool = getTool('create_issue');
    const ctx = createCtx();
    await createIssueTool.handler(
      {
        title: 'Bug report',
        body: 'Detailed description',
        labels: ['bug', 'triage'],
      },
      ctx,
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      title: 'Bug report',
      body: 'Detailed description',
      labels: ['bug', 'triage'],
    });
  });

  it('create_issue handler returns formatted text with issue number and URL', async () => {
    mockCreate.mockResolvedValueOnce({
      data: {
        number: 42,
        html_url: 'https://github.com/test-owner/test-repo/issues/42',
      },
    });

    const createIssueTool = getTool('create_issue');
    const result = await createIssueTool.handler(
      {
        title: 'Bug report',
        body: 'Detailed description',
        labels: ['bug'],
      },
      createCtx(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Created issue #42: https://github.com/test-owner/test-repo/issues/42' }],
    });
  });

  it('create_issue handler passes labels when provided', async () => {
    mockCreate.mockResolvedValueOnce({
      data: {
        number: 42,
        html_url: 'https://github.com/test-owner/test-repo/issues/42',
      },
    });

    const createIssueTool = getTool('create_issue');
    await createIssueTool.handler(
      {
        title: 'Feature request',
        body: 'Please add this',
        labels: ['enhancement'],
      },
      createCtx(),
    );

    expect(mockCreate).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      title: 'Feature request',
      body: 'Please add this',
      labels: ['enhancement'],
    });
  });

  it('create_issue handler works without labels', async () => {
    mockCreate.mockResolvedValueOnce({
      data: {
        number: 42,
        html_url: 'https://github.com/test-owner/test-repo/issues/42',
      },
    });

    const createIssueTool = getTool('create_issue');
    const result = await createIssueTool.handler(
      {
        title: 'No label issue',
        body: 'No labels attached',
      },
      createCtx(),
    );

    expect(mockCreate).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      title: 'No label issue',
      body: 'No labels attached',
      labels: undefined,
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Created issue #42: https://github.com/test-owner/test-repo/issues/42' }],
    });
  });

  it('post_pr_comment handler calls octokit.issues.createComment with owner, repo, issue_number, body', async () => {
    mockCreateComment.mockResolvedValueOnce({
      data: {
        html_url: 'https://github.com/test-owner/test-repo/issues/7#issuecomment-123',
      },
    });

    const postPrCommentTool = getTool('post_pr_comment');
    await postPrCommentTool.handler(
      {
        pull_number: 7,
        body: 'Looks good to me',
      },
      createCtx(),
    );

    expect(mockCreateComment).toHaveBeenCalledTimes(1);
    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 7,
      body: 'Looks good to me',
    });
  });

  it('post_pr_comment handler returns formatted text with comment URL', async () => {
    mockCreateComment.mockResolvedValueOnce({
      data: {
        html_url: 'https://github.com/test-owner/test-repo/issues/7#issuecomment-123',
      },
    });

    const postPrCommentTool = getTool('post_pr_comment');
    const result = await postPrCommentTool.handler(
      {
        pull_number: 7,
        body: 'Looks good to me',
      },
      createCtx(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Posted comment: https://github.com/test-owner/test-repo/issues/7#issuecomment-123' }],
    });
  });

  it('getOctokit uses token from credentials', async () => {
    mockCreate.mockResolvedValueOnce({
      data: {
        number: 42,
        html_url: 'https://github.com/test-owner/test-repo/issues/42',
      },
    });

    const createIssueTool = getTool('create_issue');
    await createIssueTool.handler(
      {
        title: 'Auth test',
        body: 'Verifies token usage',
      },
      createCtx(),
    );

    expect(Octokit).toHaveBeenCalledWith({ auth: 'ghp_test123' });
  });

  it('create_issue handler returns isError result when Octokit throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Not Found'));

    const createIssueTool = getTool('create_issue');
    const result = await createIssueTool.handler(
      {
        title: 'Bug report',
        body: 'Detailed description',
      },
      createCtx(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Not Found' }],
      isError: true,
    });
  });

  it('post_pr_comment handler returns isError result when Octokit throws', async () => {
    mockCreateComment.mockRejectedValueOnce(new Error('Forbidden'));

    const postPrCommentTool = getTool('post_pr_comment');
    const result = await postPrCommentTool.handler(
      {
        pull_number: 7,
        body: 'Looks good to me',
      },
      createCtx(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Forbidden' }],
      isError: true,
    });
  });

  it('create_issue handler returns isError on auth failure (401 Bad credentials)', async () => {
    const authError = new Error('Bad credentials');
    (authError as Error & { status: number }).status = 401;
    mockCreate.mockRejectedValueOnce(authError);

    const createIssueTool = getTool('create_issue');
    const result = await createIssueTool.handler(
      { title: 'Auth test', body: 'Should fail' },
      createCtx({ token: 'invalid-token' }),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Bad credentials' }],
      isError: true,
    });
  });

  it('create_issue handler returns isError on rate limit (403 rate limited)', async () => {
    const rateLimitError = new Error('API rate limit exceeded');
    (rateLimitError as Error & { status: number }).status = 403;
    mockCreate.mockRejectedValueOnce(rateLimitError);

    const createIssueTool = getTool('create_issue');
    const result = await createIssueTool.handler(
      { title: 'Rate limit test', body: 'Should fail' },
      createCtx(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'API rate limit exceeded' }],
      isError: true,
    });
  });

  it('create_issue handler returns isError on network error (ECONNREFUSED)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:443'));

    const createIssueTool = getTool('create_issue');
    const result = await createIssueTool.handler(
      { title: 'Network test', body: 'Should fail' },
      createCtx(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'connect ECONNREFUSED 127.0.0.1:443' }],
      isError: true,
    });
  });

  it('post_pr_comment handler returns isError on auth failure (401)', async () => {
    const authError = new Error('Bad credentials');
    (authError as Error & { status: number }).status = 401;
    mockCreateComment.mockRejectedValueOnce(authError);

    const postPrCommentTool = getTool('post_pr_comment');
    const result = await postPrCommentTool.handler(
      { pull_number: 99, body: 'Unauthorized comment' },
      createCtx({ token: 'invalid-token' }),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Bad credentials' }],
      isError: true,
    });
  });

  it('post_pr_comment handler returns isError on rate limit (403)', async () => {
    const rateLimitError = new Error('API rate limit exceeded for user');
    (rateLimitError as Error & { status: number }).status = 403;
    mockCreateComment.mockRejectedValueOnce(rateLimitError);

    const postPrCommentTool = getTool('post_pr_comment');
    const result = await postPrCommentTool.handler(
      { pull_number: 5, body: 'Rate limited comment' },
      createCtx(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'API rate limit exceeded for user' }],
      isError: true,
    });
  });

  it('post_pr_comment handler returns isError on network error', async () => {
    mockCreateComment.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const postPrCommentTool = getTool('post_pr_comment');
    const result = await postPrCommentTool.handler(
      { pull_number: 3, body: 'Timed out comment' },
      createCtx(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'ETIMEDOUT' }],
      isError: true,
    });
  });
});
