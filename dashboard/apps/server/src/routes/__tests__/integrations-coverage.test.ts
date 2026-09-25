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

vi.mock('../../services/integrations/slack.js', () => ({ sendSlackRunSummary: mockSendSlackRunSummary }));
vi.mock('../../services/integrations/webhooks.js', () => ({ dispatchWebhook: mockDispatchWebhook }));
vi.mock('../../services/ci-poller.js', () => ({ pollCIStatus: mockPollCIStatus }));
vi.mock('../../services/integrations/email.js', () => ({ sendRunReportEmail: mockSendRunReportEmail }));
vi.mock('../../utils/url-validation.js', () => ({ assertExternalUrl: mockAssertExternalUrl, assertExternalUrlWithDNS: mockAssertExternalUrlWithDNS }));

let testApp: TestApp;
let fileExists = false;
let dirExists = false;
let configFile = '{}';
const configPath = path.resolve(process.cwd(), '.automate', 'integrations.json');
const configDir = path.dirname(configPath);

describe('integrations routes additional coverage', () => {
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
    mockPollCIStatus.mockResolvedValue(null);
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

  it('GET /api/integrations/config masks short slack secrets with full bullets', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      slack: { webhookUrl: 'short', enabled: true, notifyOn: ['all'] },
      gitlab: { token: 'token-gitlab', projectId: '1', baseUrl: 'https://gitlab.example.com', enabled: true, mrComments: true },
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/integrations/config' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      slack: { webhookUrl: '••••••••', enabled: true, notifyOn: ['all'] },
      gitlab: { token: '••••••••', projectId: '1', baseUrl: 'https://gitlab.example.com', enabled: true, mrComments: true },
    });
  });

  it('PUT /api/integrations/config returns 400 for invalid payload', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/integrations/config',
      payload: { github: { enabled: 'yes' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({ error: 'Invalid config' }));
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('PUT /api/integrations/config creates config directory if missing', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/integrations/config',
      payload: { slack: { enabled: true, notifyOn: ['failed'] } },
    });

    expect(res.statusCode).toBe(200);
    expect(mockMkdirSync).toHaveBeenCalledWith(configDir, { recursive: true });
    expect(JSON.parse(configFile)).toEqual({
      slack: { enabled: true, notifyOn: ['failed'] },
    });
  });

  it('POST /api/integrations/test/slack returns 400 when webhook missing', async () => {
    fileExists = true;
    configFile = JSON.stringify({ slack: { enabled: true, notifyOn: ['all'] } });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/slack' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Slack webhook URL not configured' });
  });

  it('POST /api/integrations/test/slack returns 500 on sender error', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      slack: { webhookUrl: 'https://hooks.slack.com/services/T/B/C', enabled: true, notifyOn: ['all'] },
    });
    mockSendSlackRunSummary.mockRejectedValue(new Error('slack down'));

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/slack' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'slack down' });
  });

  it('POST /api/integrations/test/github returns 400 when config incomplete', async () => {
    fileExists = true;
    configFile = JSON.stringify({ github: { token: 'x' } });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/github' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'GitHub config incomplete' });
  });

  it('POST /api/integrations/test/github returns 500 for non-ok API response', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      github: { token: 'gh', owner: 'acme', repo: 'dashboard', enabled: true, prComments: true, commitStatus: true },
    });
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/github' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'GitHub API: 403' });
  });

  it('POST /api/integrations/test/jira handles success and failure paths', async () => {
    fileExists = true;
    configFile = JSON.stringify({
      jira: {
        baseUrl: 'https://jira.example.com',
        email: 'dev@example.com',
        apiToken: 'token',
        projectKey: 'MC',
        enabled: true,
        autoCreateBugs: true,
      },
    });

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'MC', name: 'Automate' }) });

    const okRes = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/jira' });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json()).toEqual({ connected: true, project: 'Automate' });

    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    const errRes = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/jira' });
    expect(errRes.statusCode).toBe(500);
    expect(errRes.json()).toEqual({ error: 'Jira API: 401' });
  });

  it('POST /api/integrations/test/jira returns 400 when config incomplete', async () => {
    fileExists = true;
    configFile = JSON.stringify({ jira: { baseUrl: 'https://jira.example.com' } });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/jira' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Jira config incomplete' });
  });

  it('POST /api/integrations/test/email validates config and handles sender failure', async () => {
    fileExists = true;
    configFile = JSON.stringify({ email: { host: 'smtp', user: 'bot', pass: 'secret', enabled: true, recipients: [] } });

    const missingRecipients = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/email' });
    expect(missingRecipients.statusCode).toBe(400);
    expect(missingRecipients.json()).toEqual({ error: 'No email recipients configured' });

    configFile = JSON.stringify({
      email: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'bot',
        pass: 'secret',
        enabled: true,
        recipients: ['a@example.com'],
      },
    });
    mockSendRunReportEmail.mockRejectedValue(new Error('smtp unavailable'));

    const senderFailure = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/email' });
    expect(senderFailure.statusCode).toBe(500);
    expect(senderFailure.json()).toEqual({ error: 'smtp unavailable' });
  });

  it('POST /api/integrations/webhooks validates payload and url checks', async () => {
    const invalidBody = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks',
      payload: { url: 'not-a-url', events: [] },
    });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json()).toEqual(expect.objectContaining({ error: 'Invalid webhook' }));

    fileExists = true;
    configFile = JSON.stringify({ webhooks: [] });
    mockAssertExternalUrlWithDNS.mockRejectedValue(new Error('Blocked internal URL'));

    const blocked = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks',
      payload: { url: 'http://127.0.0.1/hook', events: ['run:end'] },
    });

    expect(blocked.statusCode).toBe(500);
    expect(blocked.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'Blocked internal URL' });
  });

  it('DELETE /api/integrations/webhooks/:index returns 404 for invalid indexes', async () => {
    fileExists = true;
    configFile = JSON.stringify({ webhooks: [{ url: 'https://hooks.example/a', events: ['run:end'] }] });

    const outOfRange = await testApp.app.inject({ method: 'DELETE', url: '/api/integrations/webhooks/9' });
    expect(outOfRange.statusCode).toBe(404);
    expect(outOfRange.json()).toEqual({ error: 'Webhook not found' });

    const notNumber = await testApp.app.inject({ method: 'DELETE', url: '/api/integrations/webhooks/not-number' });
    expect(notNumber.statusCode).toBe(404);
    expect(notNumber.json()).toEqual({ error: 'Webhook not found' });
  });

  it('POST /api/integrations/webhooks/test validates url and handles sender errors', async () => {
    const invalid = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks/test',
      payload: { url: 'bad-url' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'Invalid URL' });

    mockDispatchWebhook.mockRejectedValue(new Error('webhook timeout'));
    const failure = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks/test',
      payload: { url: 'https://hooks.example/test' },
    });

    expect(failure.statusCode).toBe(500);
    expect(failure.json()).toEqual({ error: 'webhook timeout' });
  });

  it('GET /api/ci/status validates sha and handles fallback/error', async () => {
    const missing = await testApp.app.inject({ method: 'GET', url: '/api/ci/status' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: 'Missing sha parameter' });

    mockPollCIStatus.mockResolvedValue(null);
    const fallback = await testApp.app.inject({ method: 'GET', url: '/api/ci/status?sha=abc' });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.json()).toEqual({ provider: null, status: 'unknown', url: null });

    mockPollCIStatus.mockRejectedValue(new Error('ci unavailable'));
    const failure = await testApp.app.inject({ method: 'GET', url: '/api/ci/status?sha=def' });
    expect(failure.statusCode).toBe(500);
    expect(failure.json()).toEqual({ error: 'ci unavailable' });
  });
});
