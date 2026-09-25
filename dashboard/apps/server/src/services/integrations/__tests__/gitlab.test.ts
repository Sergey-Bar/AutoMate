import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommitStatus, postOrUpdateMrComment } from '../gitlab.js';

const mockFetch = vi.fn();

const gitlabConfig = {
  token: 'glpat-test-token',
  projectId: 'acme/automate',
  baseUrl: 'https://gitlab.example.com',
};

const encodedProject = encodeURIComponent(gitlabConfig.projectId);

function mockResponse(init: { ok: boolean; status: number; text?: string; json?: unknown }): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: async () => init.text ?? '',
    json: async () => init.json,
  } as unknown as Response;
}

describe('gitlab integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  describe('postOrUpdateMrComment', () => {
    it('creates new note when no existing marker comment found', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            status: 200,
            json: [
              { id: 1, body: 'some other note' },
              { id: 2, body: 'another unrelated note' },
            ],
          }),
        )
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await postOrUpdateMrComment(gitlabConfig, 7, 'test summary');

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const [listUrl, listReq] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(listUrl).toBe(
        `https://gitlab.example.com/api/v4/projects/${encodedProject}/merge_requests/7/notes`,
      );
      expect((listReq.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('glpat-test-token');

      const [postUrl, postReq] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(postUrl).toBe(
        `https://gitlab.example.com/api/v4/projects/${encodedProject}/merge_requests/7/notes`,
      );
      expect(postReq.method).toBe('POST');
      expect((postReq.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('glpat-test-token');
      expect((postReq.headers as Record<string, string>)['Content-Type']).toBe('application/json');

      const payload = JSON.parse(String(postReq.body)) as { body: string };
      expect(payload.body).toBe('<!-- automate-mr -->\ntest summary');
    });

    it('updates existing note when marker is found', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            status: 200,
            json: [
              { id: 10, body: 'plain note' },
              { id: 11, body: '<!-- automate-mr -->\nold summary' },
            ],
          }),
        )
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 200 }));

      await postOrUpdateMrComment(gitlabConfig, 42, 'new summary');

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const [putUrl, putReq] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(putUrl).toBe(
        `https://gitlab.example.com/api/v4/projects/${encodedProject}/merge_requests/42/notes/11`,
      );
      expect(putReq.method).toBe('PUT');
      expect((putReq.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('glpat-test-token');

      const payload = JSON.parse(String(putReq.body)) as { body: string };
      expect(payload.body).toBe('<!-- automate-mr -->\nnew summary');
    });

    it('URL-encodes projectId in the API path', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, json: [] }))
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await postOrUpdateMrComment(gitlabConfig, 1, 'body');

      const [listUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(listUrl).toContain(encodeURIComponent('acme/automate'));
      expect(listUrl).not.toContain('acme/automate/merge_requests');
    });

    it('throws when listing MR notes fails', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 401, text: 'unauthorized' }));

      await expect(postOrUpdateMrComment(gitlabConfig, 1, 'x')).rejects.toThrow(
        'GitLab API error listing MR notes (401): unauthorized',
      );
    });

    it('throws when creating note fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, json: [] }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 422, text: 'unprocessable' }));

      await expect(postOrUpdateMrComment(gitlabConfig, 1, 'x')).rejects.toThrow(
        'GitLab API error creating MR note (422): unprocessable',
      );
    });

    it('throws when updating note fails', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            status: 200,
            json: [{ id: 55, body: '<!-- automate-mr -->\nold' }],
          }),
        )
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 403, text: 'forbidden' }));

      await expect(postOrUpdateMrComment(gitlabConfig, 1, 'x')).rejects.toThrow(
        'GitLab API error updating MR note (403): forbidden',
      );
    });
  });

  describe('createCommitStatus', () => {
    it('posts commit status with correct URL, headers, and body', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await createCommitStatus(
        gitlabConfig,
        'deadbeef',
        'success',
        'All tests passed',
        'http://dashboard.local/runs/123',
        'automate / playwright',
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, req] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `https://gitlab.example.com/api/v4/projects/${encodedProject}/statuses/deadbeef`,
      );
      expect(req.method).toBe('POST');

      const headers = req.headers as Record<string, string>;
      expect(headers['PRIVATE-TOKEN']).toBe('glpat-test-token');
      expect(headers['Content-Type']).toBe('application/json');

      const payload = JSON.parse(String(req.body)) as {
        state: string;
        target_url: string;
        description: string;
        context: string;
      };
      expect(payload.state).toBe('success');
      expect(payload.target_url).toBe('http://dashboard.local/runs/123');
      expect(payload.description).toBe('All tests passed');
      expect(payload.context).toBe('automate / playwright');
    });

    it.each([
      ['pending', 'pending'],
      ['running', 'running'],
      ['success', 'success'],
      ['failed', 'failed'],
      ['canceled', 'canceled'],
    ] as const)('passes state %s through unchanged', async (state) => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await createCommitStatus(gitlabConfig, 'abc123', state, 'desc');

      const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(String(req.body)) as { state: string };
      expect(payload.state).toBe(state);
    });

    it('URL-encodes projectId in the API path', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await createCommitStatus(gitlabConfig, 'sha1', 'success', 'ok');

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(encodeURIComponent('acme/automate'));
      expect(url).not.toContain('acme/automate/statuses');
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: 'internal error' }));

      await expect(createCommitStatus(gitlabConfig, 'sha', 'failed', 'tests failed')).rejects.toThrow(
        'GitLab API error creating commit status (500): internal error',
      );
    });

    it('throws on network error when fetch rejects', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND gitlab.example.com'));

      await expect(createCommitStatus(gitlabConfig, 'sha', 'failed', 'tests failed')).rejects.toThrow(
        'ENOTFOUND gitlab.example.com',
      );
    });

    it('throws on rate limit (429) response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 429, text: 'too many requests' }));

      await expect(createCommitStatus(gitlabConfig, 'sha', 'success', 'ok')).rejects.toThrow(
        'GitLab API error creating commit status (429): too many requests',
      );
    });
  });

  describe('postOrUpdateMrComment — additional edge cases', () => {
    it('throws on network error during list fetch', async () => {
      mockFetch.mockRejectedValueOnce(new Error('socket timeout'));

      await expect(postOrUpdateMrComment(gitlabConfig, 1, 'body')).rejects.toThrow('socket timeout');
    });

    it('throws on rate limit (429) during list fetch', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 429, text: 'slow down' }));

      await expect(postOrUpdateMrComment(gitlabConfig, 1, 'body')).rejects.toThrow(
        'GitLab API error listing MR notes (429): slow down',
      );
    });
  });
});
