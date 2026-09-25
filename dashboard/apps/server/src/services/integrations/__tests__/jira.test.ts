import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachScreenshotToJira, createJiraBug } from '../jira.js';

const mockFetch = vi.fn();

const jiraConfig = {
  baseUrl: 'https://acme.atlassian.net',
  apiToken: 'token-123',
  email: 'bot@acme.dev',
  projectKey: 'QA',
};

function mockResponse(init: {
  ok: boolean;
  status: number;
  text?: string;
  json?: unknown;
}): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: async () => init.text ?? '',
    json: async () => init.json,
  } as unknown as Response;
}

describe('jira integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  it('creates jira bug with project/summary/description/labels/basic auth and returns issue json', async () => {
    const issue = { id: '10001', key: 'QA-99', self: 'https://acme.atlassian.net/rest/api/2/issue/10001' };
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201, json: issue }));

    const test = {
      title: 'should login successfully',
      file: 'tests/auth/login.spec.ts',
      errorMessage: 'Expected 200 but got 500',
      errorStack: 'stack-line-1\nstack-line-2',
      screenshotUrl: 'http://dashboard.local/screenshot.png',
    };

    const result = await createJiraBug(jiraConfig, test);

    expect(result).toEqual(issue);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://acme.atlassian.net/rest/api/2/issue');
    expect(req.method).toBe('POST');

    const headers = req.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('bot@acme.dev:token-123').toString('base64')}`);

    const body = JSON.parse(String(req.body)) as {
      fields: {
        project: { key: string };
        summary: string;
        description: string;
        issuetype: { name: string };
        labels: string[];
      };
    };

    expect(body.fields.project.key).toBe('QA');
    expect(body.fields.summary).toBe('[Test Failure] should login successfully');
    expect(body.fields.issuetype.name).toBe('Bug');
    expect(body.fields.labels).toEqual(['automated-test', 'automate']);
    expect(body.fields.description).toContain('*Test:* should login successfully');
    expect(body.fields.description).toContain('*File:* `tests/auth/login.spec.ts`');
    expect(body.fields.description).toContain('{code}Expected 200 but got 500{code}');
    expect(body.fields.description).toContain('{code}stack-line-1\nstack-line-2{code}');
    expect(body.fields.description).toContain('[Screenshot|http://dashboard.local/screenshot.png]');
  });

  it('omits optional lines when optional error fields are missing', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, status: 201, json: { id: '1', key: 'QA-1', self: 's' } }),
    );

    await createJiraBug(jiraConfig, {
      title: 'minimal failed test',
      file: 'tests/minimal.spec.ts',
    });

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(req.body)) as { fields: { description: string } };
    expect(body.fields.description).not.toContain('*Error:*');
    expect(body.fields.description).not.toContain('*Stack:*');
    expect(body.fields.description).not.toContain('[Screenshot|');
  });

  it('truncates error stack to 2000 chars', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, status: 201, json: { id: '1', key: 'QA-1', self: 's' } }),
    );

    const longStack = 'x'.repeat(3000);
    await createJiraBug(jiraConfig, {
      title: 'long stack test',
      file: 'tests/long.spec.ts',
      errorStack: longStack,
    });

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(req.body)) as { fields: { description: string } };
    const stackSection = body.fields.description.match(/\*Stack:\*\n\{code\}([\s\S]*)\{code\}/)?.[1] ?? '';
    expect(stackSection).toHaveLength(2000);
  });

  it('throws on non-ok response for createJiraBug', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: false, status: 400, text: 'invalid payload' }),
    );

    await expect(
      createJiraBug(jiraConfig, {
        title: 'bad',
        file: 'tests/bad.spec.ts',
      }),
    ).rejects.toThrow('Jira API error (400): invalid payload');
  });

  it('attaches screenshot using multipart form with no-check header', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200 }));

    const screenshot = Buffer.from([1, 2, 3, 4]);
    await attachScreenshotToJira(jiraConfig, 'QA-99', screenshot, 'failure.png');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://acme.atlassian.net/rest/api/2/issue/QA-99/attachments');
    expect(req.method).toBe('POST');

    const headers = req.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('bot@acme.dev:token-123').toString('base64')}`);
    expect(headers['X-Atlassian-Token']).toBe('no-check');

    const form = req.body as FormData;
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe('image/png');
  });

  it('throws on non-ok response for screenshot attach', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 500 }));

    await expect(
      attachScreenshotToJira(jiraConfig, 'QA-99', Buffer.from([1]), 'f.png'),
    ).rejects.toThrow('Jira attachment failed: 500');
  });

  it('throws on network error for createJiraBug', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND acme.atlassian.net'));

    await expect(
      createJiraBug(jiraConfig, { title: 'test', file: 'tests/test.spec.ts' }),
    ).rejects.toThrow('ENOTFOUND acme.atlassian.net');
  });

  it('throws on rate limit (429) for createJiraBug', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 429, text: 'Rate Limit Exceeded' }));

    await expect(
      createJiraBug(jiraConfig, { title: 'rate limited test', file: 'tests/rl.spec.ts' }),
    ).rejects.toThrow('Jira API error (429): Rate Limit Exceeded');
  });

  it('throws on network error for attachScreenshotToJira', async () => {
    mockFetch.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(
      attachScreenshotToJira(jiraConfig, 'QA-1', Buffer.from([1, 2]), 'fail.png'),
    ).rejects.toThrow('socket hang up');
  });

  it('sends correct Basic auth header with base64 encoded credentials', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: true, status: 201, json: { id: '2', key: 'QA-2', self: 'https://acme.atlassian.net/rest/api/2/issue/2' } }),
    );

    await createJiraBug(jiraConfig, { title: 'auth check', file: 'tests/auth.spec.ts' });

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = req.headers as Record<string, string>;
    const expectedAuth = `Basic ${Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64')}`;
    expect(headers.Authorization).toBe(expectedAuth);
  });
});
