import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestAnnotations, createCheckRun, createCommitStatus, postOrUpdatePrComment, postPrComment } from '../github.js';

const mockFetch = vi.fn();

const githubConfig = {
  token: 'ghp_test_123',
  owner: 'acme',
  repo: 'automate',
};

function createRunSummary(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-123-uuid-value',
    status: 'failed',
    total: 100,
    passed: 90,
    failed: 8,
    flaky: 1,
    skipped: 1,
    durationMs: 45000,
    branch: 'feat/login',
    dashboardUrl: 'http://dashboard.local/runs/run-123',
    failedTests: [
      {
        title: 'auth should redirect',
        file: 'tests/auth.spec.ts',
        errorMessage: 'Expected status 302 | got 500\nfull stack',
      },
    ],
    ...overrides,
  };
}

function mockResponse(init: { ok: boolean; status: number; text?: string; json?: unknown }): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: async () => init.text ?? '',
    json: async () => init.json,
  } as unknown as Response;
}

describe('github integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  describe('postPrComment', () => {
    it('posts markdown summary with metrics table and failed tests (max 20)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      const failedTests = Array.from({ length: 22 }, (_, i) => ({
        title: `failed test ${i + 1}`,
        file: `tests/f${i + 1}.spec.ts`,
        errorMessage: `error ${i + 1}`,
      }));

      await postPrComment(githubConfig, 42, createRunSummary({ failedTests }));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, req] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.github.com/repos/acme/automate/issues/42/comments');
      expect(req.method).toBe('POST');

      const headers = req.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer ghp_test_123');
      expect(headers['Content-Type']).toBe('application/json');

      const payload = JSON.parse(String(req.body)) as { body: string };
      expect(payload.body).toContain('## ❌ Playwright Test Results');
      expect(payload.body).toContain('| **Pass Rate** | 90.0% |');
      expect(payload.body).toContain('| **Duration** | 45s |');
      expect(payload.body).toContain('| **Branch** | feat/login |');
      expect(payload.body).toContain('### ❌ Failed Tests');
      expect(payload.body).toContain('| failed test 1 | `tests/f1.spec.ts` | error 1 |');
      expect(payload.body).toContain('| failed test 20 | `tests/f20.spec.ts` | error 20 |');
      expect(payload.body).not.toContain('failed test 21');
      expect(payload.body).toContain('_...and 2 more failed tests_');
      expect(payload.body).toContain('[📊 View in Dashboard](http://dashboard.local/runs/run-123)');
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: 'boom' }));

      await expect(postPrComment(githubConfig, 1, createRunSummary())).rejects.toThrow(
        'GitHub API error (500): boom',
      );
    });

    it('throws on network error when fetch rejects', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(postPrComment(githubConfig, 1, createRunSummary())).rejects.toThrow('ECONNRESET');
    });

    it('throws on rate limit (429) response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 429, text: 'rate limit exceeded' }));

      await expect(postPrComment(githubConfig, 1, createRunSummary())).rejects.toThrow(
        'GitHub API error (429): rate limit exceeded',
      );
    });

    it('omits failed tests section when failedTests is empty', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await postPrComment(githubConfig, 1, createRunSummary({ failedTests: [] }));

      const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(String(req.body)) as { body: string };
      expect(payload.body).not.toContain('### ❌ Failed Tests');
    });

    it('uses ⚠️ emoji for non-passed/failed status and shows N/A for missing optional fields', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await postPrComment(
        githubConfig,
        1,
        createRunSummary({ status: 'queued', total: 0, durationMs: undefined, branch: undefined, dashboardUrl: undefined }),
      );

      const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(String(req.body)) as { body: string };
      expect(payload.body).toContain('⚠️');
      expect(payload.body).toContain('| **Duration** | N/A |');
      expect(payload.body).toContain('| **Branch** | N/A |');
      expect(payload.body).not.toContain('[📊 View in Dashboard]');
    });

    it('uses ✅ emoji for passed status', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await postPrComment(githubConfig, 1, createRunSummary({ status: 'passed', failedTests: [] }));

      const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(String(req.body)) as { body: string };
      expect(payload.body).toContain('✅ Playwright Test Results');
    });

    it('shows em dash for a failed test that has no error message', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await postPrComment(
        githubConfig,
        1,
        createRunSummary({ failedTests: [{ title: 'broken test', file: 'tests/broken.spec.ts', errorMessage: null }] }),
      );

      const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(String(req.body)) as { body: string };
      expect(payload.body).toContain('| broken test | `tests/broken.spec.ts` | — |');
    });
  });

  describe('createCommitStatus', () => {
    it.each([
      ['passed', 'success'],
      ['failed', 'failure'],
      ['running', 'pending'],
    ])('maps run status %s to github state %s', async (status, state) => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await createCommitStatus(githubConfig, 'abc123', createRunSummary({ status }));

      const [url, req] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.github.com/repos/acme/automate/statuses/abc123');
      expect(req.method).toBe('POST');

      const payload = JSON.parse(String(req.body)) as { state: string; description: string; context: string };
      expect(payload.state).toBe(state);
      expect(payload.description).toBe('90/100 passed (8 failed)');
      expect(payload.context).toBe('Automate / Playwright');
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 403 }));
      await expect(createCommitStatus(githubConfig, 'abc', createRunSummary())).rejects.toThrow(
        'GitHub status API error: 403',
      );
    });

    it('throws on network error when fetch rejects', async () => {
      mockFetch.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));

      await expect(createCommitStatus(githubConfig, 'abc', createRunSummary())).rejects.toThrow(
        'connect ETIMEDOUT',
      );
    });

    it('throws on rate limit (429) response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 429 }));

      await expect(createCommitStatus(githubConfig, 'sha', createRunSummary())).rejects.toThrow(
        'GitHub status API error: 429',
      );
    });
  });

  describe('postOrUpdatePrComment', () => {
    it('patches existing marker comment when found', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            status: 200,
            json: [
              { id: 10, body: 'normal comment' },
              { id: 11, body: 'old body\n<!-- automate-pr -->' },
            ],
          }),
        )
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 200 }));

      await postOrUpdatePrComment(githubConfig, 42, 'new body');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, patchReq] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://api.github.com/repos/acme/automate/issues/comments/11',
      );
      expect(patchReq.method).toBe('PATCH');
      expect(JSON.parse(String(patchReq.body))).toEqual({
        body: 'new body\n<!-- automate-pr -->',
      });
    });

    it('posts new comment when marker is not found', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, json: [{ id: 10, body: 'hello' }] }))
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 201 }));

      await postOrUpdatePrComment(githubConfig, 99, 'fresh body');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://api.github.com/repos/acme/automate/issues/99/comments',
      );
      expect((mockFetch.mock.calls[1][1] as RequestInit).method).toBe('POST');
    });

    it('throws when listing comments fails', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: 'list failed' }));

      await expect(postOrUpdatePrComment(githubConfig, 1, 'x')).rejects.toThrow(
        'GitHub API error listing comments (500): list failed',
      );
    });

    it('throws when patch request fails', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ ok: true, status: 200, json: [{ id: 77, body: '<!-- automate-pr -->' }] }),
        )
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 422, text: 'cannot edit' }));

      await expect(postOrUpdatePrComment(githubConfig, 1, 'x')).rejects.toThrow(
        'GitHub API error updating comment (422): cannot edit',
      );
    });

    it('throws when post request fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, json: [{ id: 77, body: 'plain' }] }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 401, text: 'unauthorized' }));

      await expect(postOrUpdatePrComment(githubConfig, 1, 'x')).rejects.toThrow(
        'GitHub API error creating comment (401): unauthorized',
      );
    });
  });

  describe('createCheckRun', () => {
    it('posts check run with head_sha, conclusion and output summary', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201, json: { id: 1 } }));

      await createCheckRun(githubConfig, 'def456', 'failure', '2 tests failed');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, req] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.github.com/repos/acme/automate/check-runs');
      expect(req.method).toBe('POST');

      const payload = JSON.parse(String(req.body)) as {
        head_sha: string;
        conclusion: string;
        output: { summary: string; title: string; annotations?: unknown[] };
      };

      expect(payload.head_sha).toBe('def456');
      expect(payload.conclusion).toBe('failure');
      expect(payload.output.title).toBe('Playwright Test Results');
      expect(payload.output.summary).toBe('2 tests failed');
      expect(payload.output.annotations).toBeUndefined();
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: 'check api down' }));

      await expect(createCheckRun(githubConfig, 'sha', 'neutral', 'summary')).rejects.toThrow(
        'GitHub Check Run API error (500): check api down',
      );
    });

    it('includes annotations in output when checks-annotations flag is enabled', async () => {
      vi.stubEnv('FEATURE_CHECKS_ANNOTATIONS', 'true');
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201, json: { id: 42 } }));

      const annotations = [
        { path: 'tests/auth.spec.ts', start_line: 1, end_line: 1, annotation_level: 'failure' as const, message: 'Expected 302, got 500', title: 'auth should redirect' },
        { path: 'tests/login.spec.ts', start_line: 1, end_line: 1, annotation_level: 'failure' as const, message: 'Element not found', title: 'login button present' },
      ];

      await createCheckRun(githubConfig, 'abc123', 'failure', 'summary', annotations);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String((mockFetch.mock.calls[0] as [string, RequestInit])[1].body)) as {
        output: { annotations: unknown[] };
      };
      expect(payload.output.annotations).toHaveLength(2);
      expect((payload.output.annotations[0] as { path: string }).path).toBe('tests/auth.spec.ts');

      vi.unstubAllEnvs();
    });

    it('batches annotations when >50 via PATCH when flag is enabled', async () => {
      vi.stubEnv('FEATURE_CHECKS_ANNOTATIONS', 'true');
      // POST response returns check run ID
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201, json: { id: 99 } }));
      // PATCH for remaining 10
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200 }));

      const annotations = Array.from({ length: 60 }, (_, i) => ({
        path: `tests/t${i}.spec.ts`,
        start_line: 1,
        end_line: 1,
        annotation_level: 'failure' as const,
        message: `error ${i}`,
        title: `test ${i}`,
      }));

      await createCheckRun(githubConfig, 'sha', 'failure', 'summary', annotations);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const postPayload = JSON.parse(String((mockFetch.mock.calls[0] as [string, RequestInit])[1].body)) as {
        output: { annotations: unknown[] };
      };
      expect(postPayload.output.annotations).toHaveLength(50);

      const patchUrl = mockFetch.mock.calls[1][0] as string;
      expect(patchUrl).toContain('/check-runs/99');
      const patchPayload = JSON.parse(String((mockFetch.mock.calls[1] as [string, RequestInit])[1].body)) as {
        output: { annotations: unknown[] };
      };
      expect(patchPayload.output.annotations).toHaveLength(10);

      vi.unstubAllEnvs();
    });

    it('does not include annotations when checks-annotations flag is disabled', async () => {
      vi.stubEnv('FEATURE_CHECKS_ANNOTATIONS', 'false');
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201, json: { id: 1 } }));

      const annotations = [
        { path: 'tests/auth.spec.ts', start_line: 1, end_line: 1, annotation_level: 'failure' as const, message: 'fail', title: 'auth' },
      ];

      await createCheckRun(githubConfig, 'sha', 'failure', 'summary', annotations);

      const payload = JSON.parse(String((mockFetch.mock.calls[0] as [string, RequestInit])[1].body)) as {
        output: { annotations?: unknown[] };
      };
      expect(payload.output.annotations).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      vi.unstubAllEnvs();
    });

    it('throws on network error when fetch rejects', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND api.github.com'));

      await expect(createCheckRun(githubConfig, 'sha', 'failure', 'summary')).rejects.toThrow(
        'ENOTFOUND api.github.com',
      );
    });

    it('throws on rate limit (429) response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 429, text: 'rate limit' }));

      await expect(createCheckRun(githubConfig, 'sha', 'failure', 'summary')).rejects.toThrow(
        'GitHub Check Run API error (429): rate limit',
      );
    });

    it('throws when PATCH for additional annotation batches fails', async () => {
      vi.stubEnv('FEATURE_CHECKS_ANNOTATIONS', 'true');
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 201, json: { id: 55 } }));
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: 'patch error' }));

      const annotations = Array.from({ length: 55 }, (_, i) => ({
        path: `tests/t${i}.spec.ts`,
        start_line: 1,
        end_line: 1,
        annotation_level: 'failure' as const,
        message: `error ${i}`,
        title: `test ${i}`,
      }));

      await expect(createCheckRun(githubConfig, 'sha', 'failure', 'summary', annotations)).rejects.toThrow(
        'GitHub Check Run PATCH error (500): patch error',
      );

      vi.unstubAllEnvs();
    });
  });

  describe('buildTestAnnotations', () => {
    it('returns empty array for undefined failedTests', () => {
      expect(buildTestAnnotations(undefined)).toEqual([]);
    });

    it('maps failed tests to CheckAnnotation shape', () => {
      const failedTests = [
        { title: 'auth test', file: 'tests/auth.spec.ts', errorMessage: 'Expected 302' },
        { title: 'login test', file: 'tests/login.spec.ts', errorMessage: 'Timeout' },
      ];
      const annotations = buildTestAnnotations(failedTests);
      expect(annotations).toHaveLength(2);
      expect(annotations[0]).toMatchObject({
        path: 'tests/auth.spec.ts',
        start_line: 1,
        end_line: 1,
        annotation_level: 'failure',
        message: 'Expected 302',
        title: 'auth test',
      });
    });

    it('falls back to playwright.config.ts for tests without a file path', () => {
      const failedTests = [{ title: 'no-file test', file: '', errorMessage: 'boom' }];
      const annotations = buildTestAnnotations(failedTests);
      expect(annotations[0].path).toBe('playwright.config.ts');
    });

    it('uses default message when errorMessage is missing', () => {
      const failedTests = [{ title: 'no-error test', file: 'tests/t.spec.ts' }];
      const annotations = buildTestAnnotations(failedTests as Array<{ title: string; file: string; errorMessage?: string }>);
      expect(annotations[0].message).toBe('Test failed');
    });

    it('truncates annotation message exceeding 65536 bytes', () => {
      const longMessage = 'x'.repeat(70000);
      const failedTests = [{ title: 'long message test', file: 'tests/long.spec.ts', errorMessage: longMessage }];
      const annotations = buildTestAnnotations(failedTests);
      expect(Buffer.byteLength(annotations[0].message, 'utf8')).toBe(65536);
    });
  });
});
