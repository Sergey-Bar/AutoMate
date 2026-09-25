import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockSendSlackRunSummary,
  mockDispatchWebhook,
  mockPollCIStatus,
  mockSendRunReportEmail,
  mockAssertExternalUrl,
  mockAssertExternalUrlWithDNS,
  mockFetch,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(targetPath: string) => boolean>(),
  mockReadFileSync: vi.fn<(targetPath: string, encoding: string) => string>(),
  mockWriteFileSync: vi.fn<(targetPath: string, content: string, encoding: string) => void>(),
  mockMkdirSync: vi.fn<(targetPath: string, options: { recursive: boolean }) => void>(),
  mockSendSlackRunSummary: vi.fn(),
  mockDispatchWebhook: vi.fn(),
  mockPollCIStatus: vi.fn(),
  mockSendRunReportEmail: vi.fn(),
  mockAssertExternalUrl: vi.fn(),
  mockAssertExternalUrlWithDNS: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock('../..//services/integrations/slack.js', () => ({
  sendSlackRunSummary: mockSendSlackRunSummary,
}));

vi.mock('../../services/integrations/webhooks.js', () => ({
  dispatchWebhook: mockDispatchWebhook,
}));

vi.mock('../../services/ci-poller.js', () => ({
  pollCIStatus: mockPollCIStatus,
}));

vi.mock('../../services/integrations/email.js', () => ({
  sendRunReportEmail: mockSendRunReportEmail,
}));

vi.mock('../../utils/url-validation.js', () => ({
  assertExternalUrl: mockAssertExternalUrl,
  assertExternalUrlWithDNS: mockAssertExternalUrlWithDNS,
}));

let testApp: TestApp;
let fileExists = false;
let dirExists = false;
let configFile = '{}';
const configPath = path.resolve(process.cwd(), '.automate', 'integrations.json');
const configDir = path.dirname(configPath);

describe('integrations routes', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', mockFetch);
    testApp = await createTestApp();
    const { integrationsRoutes } = await import('../integrations.js');
    await integrationsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fileExists = false;
    dirExists = false;
    configFile = '{}';

    mockExistsSync.mockImplementation((targetPath) => {
      if (targetPath === configPath) return fileExists;
      if (targetPath === configDir) return dirExists;
      return false;
    });
    mockReadFileSync.mockImplementation(() => configFile);
    mockWriteFileSync.mockImplementation((_targetPath, content) => {
      configFile = content;
      fileExists = true;
    });
    mockMkdirSync.mockImplementation(() => {
      dirExists = true;
    });

    mockSendSlackRunSummary.mockResolvedValue(undefined);
    mockDispatchWebhook.mockResolvedValue(undefined);
    mockPollCIStatus.mockResolvedValue({ provider: 'github', status: 'success', url: 'https://ci.example/status/1' });
    mockSendRunReportEmail.mockResolvedValue(undefined);
    mockAssertExternalUrl.mockImplementation(() => undefined);
    mockAssertExternalUrlWithDNS.mockResolvedValue(undefined);
    mockFetch.mockReset();
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
    vi.unstubAllGlobals();
  });

  it('GET /api/integrations/config reads config and redacts secrets', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      slack: { webhookUrl: 'https://hooks.slack.com/services/AAA/BBB/CCCC', enabled: true, notifyOn: ['all'] },
      github: { token: 'ghp_secret_token', owner: 'acme', repo: 'dashboard', enabled: true, prComments: true, commitStatus: true },
      jira: { baseUrl: 'https://jira.example.com', email: 'dev@example.com', apiToken: 'jira-token', projectKey: 'MC', enabled: true, autoCreateBugs: true },
      email: { host: 'smtp.example.com', port: 587, secure: false, user: 'bot', pass: 'smtp-pass', recipients: ['a@b.com'], enabled: true },
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/integrations/config' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      slack: { webhookUrl: 'http••••CCCC', enabled: true, notifyOn: ['all'] },
      github: { token: '••••••••', owner: 'acme', repo: 'dashboard', enabled: true, prComments: true, commitStatus: true },
      jira: { baseUrl: 'https://jira.example.com', email: 'dev@example.com', apiToken: '••••••••', projectKey: 'MC', enabled: true, autoCreateBugs: true },
      email: { host: 'smtp.example.com', port: 587, secure: false, user: 'bot', pass: '••••••••', recipients: ['a@b.com'], enabled: true },
    });
  });

  it('PUT /api/integrations/config merges and writes config', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      github: { owner: 'acme', repo: 'dashboard', enabled: true, prComments: true, commitStatus: false },
    });

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/integrations/config',
      payload: { github: { token: 'ghp_new', commitStatus: true } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ saved: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(configFile) as { github: { owner: string; repo: string; token: string; commitStatus: boolean } };
    expect(written.github.owner).toBe('acme');
    expect(written.github.repo).toBe('dashboard');
    expect(written.github.token).toBe('ghp_new');
    expect(written.github.commitStatus).toBe(true);
  });

  it('POST /api/integrations/test/slack sends test payload when webhook exists', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      slack: { webhookUrl: 'https://hooks.slack.com/services/AAA/BBB/CCCC', enabled: true, notifyOn: ['all'] },
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/slack' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true });
    expect(mockSendSlackRunSummary).toHaveBeenCalledTimes(1);
    expect(mockSendSlackRunSummary).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/AAA/BBB/CCCC',
      expect.objectContaining({ runId: 'test-000', status: 'passed', total: 42 }),
    );
  });

  it('POST /api/integrations/test/github validates token by calling github api', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      github: { token: 'ghp_123', owner: 'acme', repo: 'dashboard', enabled: true, prComments: true, commitStatus: true },
    });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ full_name: 'acme/dashboard' }) });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/github' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: true, repo: 'acme/dashboard' });
    expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/repos/acme/dashboard', {
      headers: {
        Authorization: 'Bearer ghp_123',
        Accept: 'application/vnd.github+json',
      },
    });
  });

  it('POST /api/integrations/webhooks creates webhook entry', async () => {
    fileExists = true;
    configFile = JSON.stringify({ webhooks: [] });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks',
      payload: { url: 'https://hooks.example.com/notify', events: ['run.completed'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ added: true, count: 1 });
    expect(mockAssertExternalUrlWithDNS).toHaveBeenCalledWith('https://hooks.example.com/notify');
    expect(JSON.parse(configFile)).toEqual({
      webhooks: [{ url: 'https://hooks.example.com/notify', events: ['run.completed'] }],
    });
  });

  it('GET /api/integrations/webhooks lists configured webhooks', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      webhooks: [
        { url: 'https://hooks.example.com/a', events: ['run.completed'] },
        { url: 'https://hooks.example.com/b', events: ['run.failed'] },
      ],
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/integrations/webhooks' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { url: 'https://hooks.example.com/a', events: ['run.completed'] },
      { url: 'https://hooks.example.com/b', events: ['run.failed'] },
    ]);
  });

  it('DELETE /api/integrations/webhooks/:index deletes webhook by index', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      webhooks: [
        { url: 'https://hooks.example.com/a', events: ['run.completed'] },
        { url: 'https://hooks.example.com/b', events: ['run.failed'] },
      ],
    });

    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/integrations/webhooks/0' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true, count: 1 });
    expect(JSON.parse(configFile)).toEqual({
      webhooks: [{ url: 'https://hooks.example.com/b', events: ['run.failed'] }],
    });
  });

  it('GET /api/ci/status returns CI poll result', async () => {
    mockPollCIStatus.mockResolvedValue({ provider: 'github', status: 'success', url: 'https://ci.example/check/sha1' });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/ci/status?sha=abc123' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ provider: 'github', status: 'success', url: 'https://ci.example/check/sha1' });
    expect(mockPollCIStatus).toHaveBeenCalledWith('abc123');
  });

  it('GET /api/ci/status returns 400 when sha is missing', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/ci/status' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Missing sha parameter' });
  });

  it('GET /api/ci/status returns unknown status when pollCIStatus returns null', async () => {
    mockPollCIStatus.mockResolvedValue(null);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/ci/status?sha=nullsha' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ provider: null, status: 'unknown', url: null });
  });

  it('GET /api/ci/status returns 500 when pollCIStatus throws', async () => {
    mockPollCIStatus.mockRejectedValueOnce(new Error('CI provider unreachable'));

    const res = await testApp.app.inject({ method: 'GET', url: '/api/ci/status?sha=errsha' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'CI provider unreachable' });
  });

  it('PUT /api/integrations/config returns 400 on invalid payload', async () => {
    // notifyOn enum only accepts 'passed' | 'failed' | 'all' — any other value fails validation
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/integrations/config',
      payload: { slack: { notifyOn: ['invalid-event-type'] } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Invalid config' });
  });

  it('POST /api/integrations/test/slack returns 400 when webhook URL not configured', async () => {
    fileExists = true;
    configFile = JSON.stringify({ slack: { enabled: true, notifyOn: ['all'] } });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/slack' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Slack webhook URL not configured' });
  });

  it('POST /api/integrations/test/slack returns 500 when sendSlackRunSummary throws', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      slack: { webhookUrl: 'https://hooks.slack.com/services/AAA/BBB/CCCC', enabled: true, notifyOn: ['all'] },
    });
    mockSendSlackRunSummary.mockRejectedValueOnce(new Error('Slack webhook failed: 429 Too Many Requests'));

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/slack' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Slack webhook failed: 429 Too Many Requests' });
  });

  it('POST /api/integrations/test/github returns 400 when config is incomplete', async () => {
    fileExists = true;
    configFile = JSON.stringify({ github: { token: 'ghp_123', enabled: true } });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/github' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'GitHub config incomplete' });
  });

  it('POST /api/integrations/test/github returns 500 when GitHub API returns error', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      github: { token: 'ghp_bad', owner: 'acme', repo: 'dashboard', enabled: true, prComments: true, commitStatus: true },
    });
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/github' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('403') });
  });

  it('POST /api/integrations/test/jira returns 400 when config is incomplete', async () => {
    fileExists = true;
    configFile = JSON.stringify({ jira: { baseUrl: 'https://jira.example.com', enabled: true } });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/jira' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Jira config incomplete' });
  });

  it('POST /api/integrations/test/jira succeeds when Jira API returns project data', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      jira: { baseUrl: 'https://jira.example.com', email: 'bot@example.com', apiToken: 'tok', projectKey: 'QA', enabled: true, autoCreateBugs: true },
    });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ key: 'QA', name: 'Quality Assurance' }) });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/jira' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: true, project: 'Quality Assurance' });
  });

  it('POST /api/integrations/test/jira returns 500 when Jira API returns error', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      jira: { baseUrl: 'https://jira.example.com', email: 'bot@example.com', apiToken: 'bad', projectKey: 'QA', enabled: true, autoCreateBugs: true },
    });
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/jira' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('401') });
  });

  it('POST /api/integrations/test/email returns 400 when SMTP config is incomplete', async () => {
    fileExists = true;
    configFile = JSON.stringify({ email: { host: 'smtp.example.com', enabled: true } });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/email' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Email SMTP config incomplete' });
  });

  it('POST /api/integrations/test/email returns 400 when no recipients configured', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      email: { host: 'smtp.example.com', port: 587, secure: false, user: 'bot', pass: 'pass', recipients: [], enabled: true },
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/email' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No email recipients configured' });
  });

  it('POST /api/integrations/test/email succeeds when sendRunReportEmail resolves', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      email: { host: 'smtp.example.com', port: 587, secure: false, user: 'bot', pass: 'pass', recipients: ['a@b.com'], enabled: true },
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/email' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true });
    expect(mockSendRunReportEmail).toHaveBeenCalledTimes(1);
  });

  it('POST /api/integrations/test/email returns 500 when sendRunReportEmail throws', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      email: { host: 'smtp.example.com', port: 587, secure: false, user: 'bot', pass: 'pass', recipients: ['a@b.com'], enabled: true },
    });
    mockSendRunReportEmail.mockRejectedValueOnce(new Error('SMTP auth failed'));

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/email' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'SMTP auth failed' });
  });

  it('DELETE /api/integrations/webhooks/:index returns 404 for out-of-bounds index', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      webhooks: [{ url: 'https://hooks.example.com/a', events: ['run.completed'] }],
    });

    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/integrations/webhooks/5' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Webhook not found' });
  });

  it('DELETE /api/integrations/webhooks/:index returns 404 for negative index', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      webhooks: [{ url: 'https://hooks.example.com/a', events: ['run.completed'] }],
    });

    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/integrations/webhooks/-1' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Webhook not found' });
  });

  it('POST /api/integrations/webhooks returns 400 for invalid URL', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks',
      payload: { url: 'not-a-url', events: ['run.completed'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Invalid webhook' });
  });

  it('POST /api/integrations/webhooks returns 400 when events array is empty', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks',
      payload: { url: 'https://hooks.example.com/notify', events: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Invalid webhook' });
  });

  it('POST /api/integrations/webhooks/test sends test event to provided URL', async () => {
    fileExists = true;
    configFile = JSON.stringify({});

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks/test',
      payload: { url: 'https://hooks.example.com/test' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true });
    expect(mockDispatchWebhook).toHaveBeenCalledWith(
      'https://hooks.example.com/test',
      'test',
      { message: 'This is a test webhook from Automate' },
    );
  });

  it('POST /api/integrations/webhooks/test returns 400 for invalid URL', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks/test',
      payload: { url: 'not-valid' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid URL' });
  });

  it('POST /api/integrations/webhooks/test returns 500 when dispatchWebhook throws', async () => {
    fileExists = true;
    configFile = JSON.stringify({});
    mockDispatchWebhook.mockRejectedValueOnce(new Error('Webhook unreachable'));

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks/test',
      payload: { url: 'https://hooks.example.com/test' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Webhook unreachable' });
  });

  it('GET /api/integrations/config returns empty object when no config file exists', async () => {
    fileExists = false;

    const res = await testApp.app.inject({ method: 'GET', url: '/api/integrations/config' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('GET /api/integrations/config redacts gitlab token', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      gitlab: { token: 'glpat-secret-token-here', projectId: 'acme/dashboard', baseUrl: 'https://gitlab.example.com', enabled: true },
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/integrations/config' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      gitlab: { token: '••••••••' },
    });
  });
});
