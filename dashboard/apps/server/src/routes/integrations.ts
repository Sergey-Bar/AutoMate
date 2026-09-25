/**
 * integrations.ts — REST routes for managing integration configs
 *
 * GET  /api/integrations/config — read all integration settings
 * PUT  /api/integrations/config — update integration settings
 * POST /api/integrations/test/slack  — send a test Slack message
 * POST /api/integrations/test/github — test GitHub connection
 * POST /api/integrations/test/email  — send a test email
 * GET  /api/integrations/webhooks — read webhook configs
 * POST /api/integrations/webhooks — add new webhook
 * DELETE /api/integrations/webhooks/:index — remove webhook by index
 * POST /api/integrations/webhooks/test — send test payload to webhook URL
 * GET  /api/ci/status?sha= — poll CI status for a commit SHA
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendSlackRunSummary } from '../services/integrations/slack.js';
import { dispatchWebhook } from '../services/integrations/webhooks.js';
import { pollCIStatus } from '../services/ci-poller.js';
import { sendRunReportEmail } from '../services/integrations/email.js';
import { assertExternalUrlWithDNS } from '../utils/url-validation.js';
import {
  readConfig,
  writeConfig,
  IntegrationConfigSchema,
  type IntegrationConfig,
  type WebhookEntry,
} from '../services/integrations/config.js';

export async function integrationsRoutes(app: FastifyInstance) {
  // GET /api/integrations/config
  app.get('/api/integrations/config', async (_req, reply) => {
    const config = readConfig();
    // Redact sensitive fields for the response
    const redacted = { ...config };
    if (redacted.slack?.webhookUrl) {
      redacted.slack = { ...redacted.slack, webhookUrl: maskSecret(redacted.slack.webhookUrl) };
    }
    if (redacted.jira?.apiToken) {
      redacted.jira = { ...redacted.jira, apiToken: '••••••••' };
    }
    if (redacted.github?.token) {
      redacted.github = { ...redacted.github, token: '••••••••' };
    }
    if (redacted.gitlab?.token) {
      redacted.gitlab = { ...redacted.gitlab, token: '••••••••' };
    }
    if (redacted.email?.pass) {
      redacted.email = { ...redacted.email, pass: '••••••••' };
    }
    return reply.send(redacted);
  });

  // PUT /api/integrations/config — auth enforced by global onRequest hook in plugins/auth.ts
  app.put('/api/integrations/config', async (req, reply) => {
    const body = IntegrationConfigSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Invalid config', details: body.error.flatten() });

    const existing = readConfig();
    const merged: IntegrationConfig = {
      slack: body.data.slack ? { ...existing.slack, ...body.data.slack } as IntegrationConfig['slack'] : existing.slack,
      jira: body.data.jira ? { ...existing.jira, ...body.data.jira } as IntegrationConfig['jira'] : existing.jira,
      github: body.data.github ? { ...existing.github, ...body.data.github } as IntegrationConfig['github'] : existing.github,
      gitlab: body.data.gitlab ? { ...existing.gitlab, ...body.data.gitlab } as IntegrationConfig['gitlab'] : existing.gitlab,
      email: body.data.email ? { ...existing.email, ...body.data.email } as IntegrationConfig['email'] : existing.email,
    };

    writeConfig(merged);
    return reply.send({ saved: true });
  });

  // POST /api/integrations/test/slack — send test message
  app.post('/api/integrations/test/slack', async (_req, reply) => {
    const config = readConfig();
    if (!config.slack?.webhookUrl) {
      return reply.status(400).send({ error: 'Slack webhook URL not configured' });
    }

    try {
      await sendSlackRunSummary(config.slack.webhookUrl, {
        runId: 'test-000',
        status: 'passed',
        total: 42,
        passed: 40,
        failed: 1,
        flaky: 1,
        skipped: 0,
        durationMs: 62000,
        branch: 'main',
        dashboardUrl: 'http://localhost:4000',
      });
      return reply.send({ sent: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/integrations/test/github — test GitHub connection
  app.post('/api/integrations/test/github', async (_req, reply) => {
    const config = readConfig();
    if (!config.github?.token || !config.github?.owner || !config.github?.repo) {
      return reply.status(400).send({ error: 'GitHub config incomplete' });
    }

    try {
      const res = await fetch(
        `https://api.github.com/repos/${config.github.owner}/${config.github.repo}`,
        {
          headers: {
            Authorization: `Bearer ${config.github.token}`,
            Accept: 'application/vnd.github+json',
          },
        },
      );

      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
      const repo = (await res.json()) as { full_name: string };
      return reply.send({ connected: true, repo: repo.full_name });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/integrations/test/jira — test Jira connection
  app.post('/api/integrations/test/jira', async (_req, reply) => {
    const config = readConfig();
    if (!config.jira?.baseUrl || !config.jira?.email || !config.jira?.apiToken || !config.jira?.projectKey) {
      return reply.status(400).send({ error: 'Jira config incomplete' });
    }

    try {
      const auth = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');
      const res = await fetch(`${config.jira.baseUrl}/rest/api/2/project/${config.jira.projectKey}`, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) throw new Error(`Jira API: ${res.status}`);
      const project = (await res.json()) as { key: string; name: string };
      return reply.send({ connected: true, project: project.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/integrations/test/email — send test email
  app.post('/api/integrations/test/email', async (_req, reply) => {
    const config = readConfig();
    if (!config.email?.host || !config.email?.user || !config.email?.pass) {
      return reply.status(400).send({ error: 'Email SMTP config incomplete' });
    }
    if (!config.email.recipients?.length) {
      return reply.status(400).send({ error: 'No email recipients configured' });
    }

    try {
      await sendRunReportEmail(
        { host: config.email.host, port: config.email.port, secure: config.email.secure, user: config.email.user, pass: config.email.pass },
        config.email.recipients,
        {
          runId: 'test-000',
          status: 'passed',
          total: 42,
          passed: 40,
          failed: 1,
          flaky: 1,
          skipped: 0,
          durationMs: 62000,
          branch: 'main',
          dashboardUrl: 'http://localhost:4000',
        },
      );
      return reply.send({ sent: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // ── Webhook CRUD ──────────────────────────────────────────────────────

  // GET /api/integrations/webhooks — list all webhooks
  app.get('/api/integrations/webhooks', async (_req, reply) => {
    const config = readConfig();
    return reply.send(config.webhooks ?? []);
  });

  // POST /api/integrations/webhooks — add a webhook
  app.post('/api/integrations/webhooks', async (req, reply) => {
    const schema = z.object({
      url: z.string().url(),
      events: z.array(z.string()).min(1),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Invalid webhook', details: body.error.flatten() });

    const config = readConfig();
    const webhooks: WebhookEntry[] = config.webhooks ?? [];
    await assertExternalUrlWithDNS(body.data.url);
    webhooks.push({ url: body.data.url, events: body.data.events });
    writeConfig({ ...config, webhooks });
    return reply.send({ added: true, count: webhooks.length });
  });

  // DELETE /api/integrations/webhooks/:index — remove by index
  app.delete<{ Params: { index: string } }>('/api/integrations/webhooks/:index', async (req, reply) => {
    const idx = parseInt(req.params.index, 10);
    const config = readConfig();
    const webhooks: WebhookEntry[] = config.webhooks ?? [];
    if (isNaN(idx) || idx < 0 || idx >= webhooks.length) {
      return reply.status(404).send({ error: 'Webhook not found' });
    }
    webhooks.splice(idx, 1);
    writeConfig({ ...config, webhooks });
    return reply.send({ deleted: true, count: webhooks.length });
  });

  // POST /api/integrations/webhooks/test — send test payload
  app.post('/api/integrations/webhooks/test', async (req, reply) => {
    const schema = z.object({ url: z.string().url() });
    const body = schema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Invalid URL' });

    try {
      await assertExternalUrlWithDNS(body.data.url);
      await dispatchWebhook(body.data.url, 'test', {
        message: 'This is a test webhook from Automate',
      });
      return reply.send({ sent: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // ── CI Status ───────────────────────────────────────────────────────

  // GET /api/ci/status?sha= — poll CI status for a commit
  app.get<{ Querystring: { sha?: string } }>('/api/ci/status', async (req, reply) => {
    const sha = req.query.sha;
    if (!sha) return reply.status(400).send({ error: 'Missing sha parameter' });

    try {
      const result = await pollCIStatus(sha);
      return reply.send(result ?? { provider: null, status: 'unknown', url: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });
}

function maskSecret(s: string): string {
  if (s.length <= 8) return '••••••••';
  return s.slice(0, 4) + '••••' + s.slice(-4);
}
