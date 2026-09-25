import { describe, expect, it, vi, beforeEach } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: fsMocks.existsSync,
  readFileSync: fsMocks.readFileSync,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('pollCIStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when integration config file does not exist', async () => {
    fsMocks.existsSync.mockReturnValue(false);
    const { pollCIStatus } = await import('../ci-poller.js');

    const result = await pollCIStatus('abc123');

    expect(result).toBeNull();
    expect(fsMocks.readFileSync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when config is missing required github fields', async () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({ github: { token: 'ghp_xxx', owner: 'org-only' } }),
    );

    const { pollCIStatus } = await import('../ci-poller.js');
    const result = await pollCIStatus('abc123');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when workflow runs list is empty', async () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({
        github: { token: 'ghp_token', owner: 'playwright', repo: 'dashboard' },
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ total_count: 0, workflow_runs: [] }),
    });

    const { pollCIStatus } = await import('../ci-poller.js');
    const result = await pollCIStatus('deadbeef');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/playwright/dashboard/actions/runs?head_sha=deadbeef',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_token',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }),
      }),
    );
  });

  it('returns success status for completed successful run', async () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({
        github: { token: 'ghp_token', owner: 'acme', repo: 'webapp' },
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        total_count: 1,
        workflow_runs: [
          {
            id: 101,
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/acme/webapp/actions/runs/101',
          },
        ],
      }),
    });

    const { pollCIStatus } = await import('../ci-poller.js');
    const result = await pollCIStatus('sha-success');

    expect(result).toEqual({
      provider: 'github',
      status: 'success',
      url: 'https://github.com/acme/webapp/actions/runs/101',
      runId: '101',
    });
  });

  it('returns failure status for completed failed run', async () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({
        github: { token: 'ghp_token', owner: 'acme', repo: 'webapp' },
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        total_count: 1,
        workflow_runs: [
          {
            id: 102,
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.com/acme/webapp/actions/runs/102',
          },
        ],
      }),
    });

    const { pollCIStatus } = await import('../ci-poller.js');
    const result = await pollCIStatus('sha-failure');

    expect(result).toEqual({
      provider: 'github',
      status: 'failure',
      url: 'https://github.com/acme/webapp/actions/runs/102',
      runId: '102',
    });
  });

  it('returns in_progress status for running workflow', async () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({
        github: { token: 'ghp_token', owner: 'acme', repo: 'webapp' },
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        total_count: 1,
        workflow_runs: [
          {
            id: 103,
            status: 'in_progress',
            conclusion: null,
            html_url: 'https://github.com/acme/webapp/actions/runs/103',
          },
        ],
      }),
    });

    const { pollCIStatus } = await import('../ci-poller.js');
    const result = await pollCIStatus('sha-running');

    expect(result).toEqual({
      provider: 'github',
      status: 'in_progress',
      url: 'https://github.com/acme/webapp/actions/runs/103',
      runId: '103',
    });
  });

  it('throws when GitHub API responds with error', async () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({
        github: { token: 'ghp_token', owner: 'acme', repo: 'webapp' },
      }),
    );
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const { pollCIStatus } = await import('../ci-poller.js');

    await expect(pollCIStatus('sha-api-error')).rejects.toThrow('GitHub Actions API returned 500');
  });

  it('maps additional run conclusions and statuses correctly', async () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({
        github: { token: 'ghp_token', owner: 'acme', repo: 'webapp' },
      }),
    );
    const { pollCIStatus } = await import('../ci-poller.js');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        workflow_runs: [
          {
            id: 201,
            status: 'completed',
            conclusion: 'cancelled',
            html_url: 'https://github.com/acme/webapp/actions/runs/201',
          },
        ],
      }),
    });
    await expect(pollCIStatus('sha-cancelled')).resolves.toEqual(
      expect.objectContaining({ status: 'cancelled' }),
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        workflow_runs: [
          {
            id: 202,
            status: 'completed',
            conclusion: 'timed_out',
            html_url: 'https://github.com/acme/webapp/actions/runs/202',
          },
        ],
      }),
    });
    await expect(pollCIStatus('sha-timeout')).resolves.toEqual(
      expect.objectContaining({ status: 'timed_out' }),
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        workflow_runs: [
          {
            id: 203,
            status: 'queued',
            conclusion: null,
            html_url: 'https://github.com/acme/webapp/actions/runs/203',
          },
        ],
      }),
    });
    await expect(pollCIStatus('sha-queued')).resolves.toEqual(
      expect.objectContaining({ status: 'queued' }),
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        workflow_runs: [
          {
            id: 204,
            status: 'completed',
            conclusion: 'neutral',
            html_url: 'https://github.com/acme/webapp/actions/runs/204',
          },
        ],
      }),
    });
    await expect(pollCIStatus('sha-neutral')).resolves.toEqual(
      expect.objectContaining({ status: 'neutral' }),
    );
  });
});
