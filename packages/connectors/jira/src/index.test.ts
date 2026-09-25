import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@automate/connector-sdk';
import { jiraManifest } from './index.js';

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

function createCtx(overrides?: Partial<Record<string, string>>): ToolContext {
  return {
    credentials: {
      baseUrl: 'https://test.atlassian.net',
      email: 'user@test.com',
      apiToken: 'test-token',
      projectKey: 'TEST',
      ...overrides,
    },
    abortSignal: new AbortController().signal,
  };
}

function getTool(name: 'create_issue' | 'search_issues') {
  return jiraManifest.tools.find((tool) => tool.name === name);
}

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('jiraManifest', () => {
  it('exposes create_issue and search_issues tools', () => {
    const toolNames = jiraManifest.tools.map((tool) => tool.name);
    expect(toolNames).toContain('create_issue');
    expect(toolNames).toContain('search_issues');
  });

  it('create_issue handler calls fetch with correct URL, auth header, body and returns formatted text', async () => {
    const createIssue = getTool('create_issue');
    const ctx = createCtx();

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ key: 'TEST-123' }),
    });

    const result = await createIssue!.handler(
      { summary: 'Bug summary', description: 'Bug details', issueType: 'Task' },
      ctx,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://test.atlassian.net/rest/api/3/issue');
    expect(url).toContain('/rest/api/3/issue');
    expect(options.method).toBe('POST');
    expect(options.signal).toBe(ctx.abortSignal);

    const expectedAuth = `Basic ${Buffer.from('user@test.com:test-token').toString('base64')}`;
    expect(options.headers).toEqual(
      expect.objectContaining({
        Authorization: expectedAuth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
    );

    expect(options.body).toBe(
      JSON.stringify({
        fields: {
          project: { key: 'TEST' },
          summary: 'Bug summary',
          description: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bug details' }] }],
          },
          issuetype: { name: 'Task' },
        },
      }),
    );

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Created TEST-123: https://test.atlassian.net/browse/TEST-123',
        },
      ],
    });
  });

  it('create_issue handler uses projectKey from credentials', async () => {
    const createIssue = getTool('create_issue');
    const ctx = createCtx({ projectKey: 'PROJ' });

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ key: 'PROJ-55' }),
    });

    await createIssue!.handler(
      { summary: 'Use credentials key', description: 'Details', issueType: 'Bug' },
      ctx,
    );

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(options.body as string) as {
      fields: { project: { key: string } };
    };

    expect(payload.fields.project.key).toBe('PROJ');
  });

  it('search_issues handler calls fetch with JQL-encoded URL', async () => {
    const searchIssues = getTool('search_issues');
    const ctx = createCtx();
    const jql = 'project = TEST AND summary ~ "hello world"';

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ issues: [] }),
    });

    await searchIssues!.handler({ jql, maxResults: 25 }, ctx);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://test.atlassian.net/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=25`,
    );
  });

  it('search_issues handler returns formatted issue list', async () => {
    const searchIssues = getTool('search_issues');

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        issues: [
          { key: 'TEST-1', fields: { summary: 'First issue' } },
          { key: 'TEST-2', fields: { summary: 'Second issue' } },
        ],
      }),
    });

    const result = await searchIssues!.handler(
      { jql: 'project = TEST', maxResults: 10 },
      createCtx(),
    );

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'TEST-1: First issue\nTEST-2: Second issue',
        },
      ],
    });
  });

  it("search_issues handler returns 'No issues found' when no issues", async () => {
    const searchIssues = getTool('search_issues');

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ issues: [] }),
    });

    const result = await searchIssues!.handler(
      { jql: 'project = TEST', maxResults: 10 },
      createCtx(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'No issues found' }],
    });
  });

  it('search_issues handler handles missing fields gracefully', async () => {
    const searchIssues = getTool('search_issues');

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        issues: [{ key: 'TEST-9' }],
      }),
    });

    const result = await searchIssues!.handler(
      { jql: 'project = TEST', maxResults: 10 },
      createCtx(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'TEST-9: undefined' }],
    });
  });

  it('jiraFetch uses Basic auth with base64(email:apiToken)', async () => {
    const searchIssues = getTool('search_issues');
    const ctx = createCtx({ email: 'dev@example.com', apiToken: 'secret-token' });

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ issues: [] }),
    });

    await searchIssues!.handler({ jql: 'project = TEST', maxResults: 1 }, ctx);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const expectedAuth = `Basic ${Buffer.from('dev@example.com:secret-token').toString('base64')}`;
    expect(options.headers).toEqual(
      expect.objectContaining({
        Authorization: expectedAuth,
      }),
    );
  });

  it('create_issue handler returns isError result on non-ok HTTP response', async () => {
    const createIssue = getTool('create_issue');
    const ctx = createCtx();

    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue('{"errorMessages":["project is required"]}'),
    });

    const result = await createIssue!.handler(
      { summary: 'Bug', description: 'Details', issueType: 'Bug' },
      ctx,
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Jira API error 400: {"errorMessages":["project is required"]}' }],
      isError: true,
    });
  });

  it('create_issue handler returns isError result when fetch throws', async () => {
    const createIssue = getTool('create_issue');
    const ctx = createCtx();

    mockFetch.mockRejectedValue(new Error('Network failure'));

    const result = await createIssue!.handler(
      { summary: 'Bug', description: 'Details', issueType: 'Bug' },
      ctx,
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'create_issue failed: Network failure' }],
      isError: true,
    });
  });

  it('search_issues handler returns isError result on non-ok HTTP response', async () => {
    const searchIssues = getTool('search_issues');
    const ctx = createCtx();

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });

    const result = await searchIssues!.handler(
      { jql: 'project = TEST', maxResults: 10 },
      ctx,
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Jira API error 401: Unauthorized' }],
      isError: true,
    });
  });

  it('search_issues handler returns isError result when fetch throws', async () => {
    const searchIssues = getTool('search_issues');
    const ctx = createCtx();

    mockFetch.mockRejectedValue(new Error('Connection refused'));

    const result = await searchIssues!.handler(
      { jql: 'project = TEST', maxResults: 10 },
      ctx,
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'search_issues failed: Connection refused' }],
      isError: true,
    });
  });

  it('create_issue returns isError on auth failure (401 Unauthorized)', async () => {
    const createIssue = getTool('create_issue');
    const ctx = createCtx({ apiToken: 'bad-token' });

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });

    const result = await createIssue!.handler(
      { summary: 'Auth fail', description: 'Invalid creds', issueType: 'Bug' },
      ctx,
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Jira API error 401: Unauthorized' }],
      isError: true,
    });
  });

  it('create_issue returns isError on forbidden (403)', async () => {
    const createIssue = getTool('create_issue');
    const ctx = createCtx();

    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue('You do not have permission to create issues in this project.'),
    });

    const result = await createIssue!.handler(
      { summary: 'Forbidden issue', description: 'No permission', issueType: 'Bug' },
      ctx,
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Jira API error 403: You do not have permission to create issues in this project.' }],
      isError: true,
    });
  });

  it('search_issues returns isError on auth failure (401 Unauthorized)', async () => {
    const searchIssues = getTool('search_issues');
    const ctx = createCtx({ email: 'wrong@user.com', apiToken: 'invalid' });

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });

    const result = await searchIssues!.handler(
      { jql: 'project = SECRET', maxResults: 5 },
      ctx,
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Jira API error 401: Unauthorized' }],
      isError: true,
    });
  });

  it('create_issue returns isError on network error', async () => {
    const createIssue = getTool('create_issue');
    const ctx = createCtx();

    mockFetch.mockRejectedValue(new Error('fetch failed: connect ECONNREFUSED'));

    const result = await createIssue!.handler(
      { summary: 'Network fail', description: 'Cannot reach server', issueType: 'Bug' },
      ctx,
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'create_issue failed: fetch failed: connect ECONNREFUSED' }],
      isError: true,
    });
  });

  it('search_issues returns isError on network error', async () => {
    const searchIssues = getTool('search_issues');
    const ctx = createCtx();

    mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await searchIssues!.handler(
      { jql: 'project = TEST', maxResults: 10 },
      ctx,
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'search_issues failed: ETIMEDOUT' }],
      isError: true,
    });
  });
});
