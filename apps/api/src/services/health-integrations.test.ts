import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorAdapter, ConnectorRequest } from '@automate/connectors-sdk';
import {
  HEALTH_DIMENSIONS,
  type CanonicalFinding,
  type HealthGrade,
} from '@automate/shared-contracts';
import {
  COMMENT_MARKER,
  alertsFor,
  deliverAlerts,
  githubRepository,
  isAllowedWebhook,
  renderGateComment,
  reportToGitHub,
  signWebhook,
} from './health-integrations.js';

function grade(
  letter: HealthGrade['letter'],
  limiter = 'Limited by Security — 1 high open from semgrep',
): HealthGrade {
  return {
    score: letter === null ? null : 72,
    letter,
    incomplete: letter === null,
    incompleteReason: letter === null ? 'Security has not been measured' : null,
    cappedBy: letter === null ? null : 'security',
    cappingValue: null,
    limiter: letter === null ? null : limiter,
    dimensions: HEALTH_DIMENSIONS.map((dimension) => ({
      dimension,
      measured: dimension === 'security',
      score: dimension === 'security' ? 72 : null,
      letter: dimension === 'security' ? letter : null,
      weight: 1,
      tools: [],
      openFindings: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      summary: [],
    })),
    gates: [],
    fixNext: [],
  };
}

function finding(overrides: Partial<CanonicalFinding> = {}): CanonicalFinding {
  return {
    fingerprint: 'fp',
    tool: 'semgrep',
    ruleId: 'sql-injection',
    kind: 'issue',
    severity: 'critical',
    dimension: 'security',
    path: 'src/db.ts',
    line: 12,
    message: 'm',
    helpUri: null,
    fixAvailable: null,
    ...overrides,
  };
}

/** A connector that answers from a table of operations and records every request. */
function fakeAdapter(answers: Record<string, unknown>, failing: readonly string[] = []) {
  const requests: ConnectorRequest[] = [];
  const adapter: ConnectorAdapter = {
    manifest: { name: 'fake', version: '1', operations: {} },
    execute: vi.fn(async (request: ConnectorRequest) => {
      requests.push(request);
      if (failing.includes(request.operation)) {
        return {
          status: 'error' as const,
          error: { code: 'github_403', retryable: false, message: 'no' },
          attempts: 1,
        };
      }
      return { status: 'ok' as const, data: answers[request.operation] ?? {}, attempts: 1 };
    }),
  };
  return { adapter, requests };
}

describe('githubRepository', () => {
  it.each([
    ['https://github.com/o/r.git', { owner: 'o', repo: 'r' }],
    ['https://github.com/o/r', { owner: 'o', repo: 'r' }],
    ['git@github.com:o/r.git', { owner: 'o', repo: 'r' }],
    ['ssh://git@github.com/o/r.git', { owner: 'o', repo: 'r' }],
    ['https://gitlab.com/o/r.git', null],
    ['https://github.com.evil.test/o/r', null],
    [null, null],
  ])('%s → %j', (url, expected) => {
    expect(githubRepository(url)).toEqual(expected);
  });
});

describe('the pull-request comment', () => {
  const report = {
    verdict: {
      verdict: 'failed' as const,
      reasons: ['1 new critical finding (at most 0 allowed)'],
      newFindings: { critical: 1, high: 0, total: 1 },
    },
    grade: grade('C'),
    added: [finding({ ruleId: 'evil|rule`', path: 'a|b.ts' })],
    branch: 'feature/x',
    detailsUrl: 'https://automate.example/dashboard/repo/p',
  };

  it('starts with the marker, says why the gate failed, and links to the dashboard', () => {
    const body = renderGateComment(report);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('C · 72 / 100 — gate failed');
    expect(body).toContain('- 1 new critical finding (at most 0 allowed)');
    expect(body).toContain('[Open the dashboard](https://automate.example/dashboard/repo/p)');
    expect(body).toContain('Security C');
  });

  it('keeps a scanner-supplied rule or path from breaking the table', () => {
    const row = renderGateComment(report)
      .split('\n')
      .find((line) => line.startsWith('| critical'));
    expect(row?.split('|')).toHaveLength(5);
  });

  it('creates the comment the first time and updates it after', async () => {
    const first = fakeAdapter({ listIssueComments: [{ id: 1, body: 'unrelated' }] });
    expect(
      await reportToGitHub(
        first.adapter,
        't',
        { owner: 'o', repo: 'r', sha: 'abc1234', pullRequest: 7 },
        report,
      ),
    ).toEqual({ status: true, comment: 'created' });
    expect(first.requests.map((request) => request.operation)).toEqual([
      'createCommitStatus',
      'listIssueComments',
      'createIssueComment',
    ]);
    expect(first.requests[0]?.input).toMatchObject({
      sha: 'abc1234',
      state: 'failure',
      context: 'automate/health',
    });

    const again = fakeAdapter({ listIssueComments: [{ id: 42, body: `${COMMENT_MARKER}\nold` }] });
    expect(
      (
        await reportToGitHub(
          again.adapter,
          't',
          { owner: 'o', repo: 'r', sha: 'abc1234', pullRequest: 7 },
          report,
        )
      ).comment,
    ).toBe('updated');
    expect(again.requests.at(-1)).toMatchObject({
      operation: 'updateIssueComment',
      input: { commentId: '42' },
    });
  });

  it('posts only the status without a pull request, and reports a refusal rather than throwing', async () => {
    const statusOnly = fakeAdapter({});
    expect(
      await reportToGitHub(
        statusOnly.adapter,
        't',
        { owner: 'o', repo: 'r', sha: 'abc1234' },
        { ...report, verdict: { ...report.verdict, verdict: 'passed', reasons: [] } },
      ),
    ).toEqual({ status: true, comment: 'skipped' });
    expect(statusOnly.requests[0]?.input).toMatchObject({
      state: 'success',
      description: 'Graded C',
    });
    const refused = fakeAdapter({}, ['createCommitStatus', 'listIssueComments']);
    expect(
      await reportToGitHub(
        refused.adapter,
        't',
        { owner: 'o', repo: 'r', sha: 'abc1234', pullRequest: 1 },
        report,
      ),
    ).toEqual({ status: false, comment: 'failed', error: 'github_403' });
  });
});

describe('alerts', () => {
  it('fires on a drop and on a new critical, on the default branch only', () => {
    expect(
      alertsFor({
        previous: { letter: 'B' },
        current: grade('C'),
        added: [],
        onDefaultBranch: true,
      }),
    ).toEqual([
      {
        kind: 'grade-dropped',
        from: 'B',
        to: 'C',
        limiter: 'Limited by Security — 1 high open from semgrep',
      },
    ]);
    expect(
      alertsFor({
        previous: { letter: 'C' },
        current: grade('C'),
        added: [],
        onDefaultBranch: true,
      }),
    ).toEqual([]);
    expect(
      alertsFor({
        previous: { letter: 'C' },
        current: grade('B'),
        added: [],
        onDefaultBranch: true,
      }),
    ).toEqual([]);
    expect(
      alertsFor({ previous: null, current: grade('F'), added: [], onDefaultBranch: true }),
    ).toEqual([]);
    expect(
      alertsFor({
        previous: { letter: 'A' },
        current: grade(null),
        added: [],
        onDefaultBranch: true,
      })[0],
    ).toMatchObject({ kind: 'grade-dropped', to: null });
    expect(
      alertsFor({
        previous: { letter: 'B' },
        current: grade('B'),
        added: [finding(), finding({ severity: 'high' })],
        onDefaultBranch: true,
      }),
    ).toEqual([
      {
        kind: 'new-critical',
        findings: [{ tool: 'semgrep', ruleId: 'sql-injection', path: 'src/db.ts', line: 12 }],
      },
    ]);
    expect(
      alertsFor({
        previous: { letter: 'B' },
        current: grade('F'),
        added: [finding()],
        onDefaultBranch: false,
      }),
    ).toEqual([]);
  });

  it('signs a webhook body so the receiver can check it', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    });
    const secret = 's'.repeat(40);
    const outcomes = await deliverAlerts(
      {
        webhookSecret: secret,
        fetch: fetcher as typeof fetch,
        now: () => new Date('2026-10-23T00:00:00.000Z'),
      },
      { webhookUrl: 'https://hooks.example.test/automate' },
      {
        projectId: 'p',
        project: 'Service',
        branch: 'main',
        detailsUrl: null,
        alerts: [{ kind: 'new-critical', findings: [] }],
      },
    );
    expect(outcomes).toEqual(['webhook: 204']);
    const body = String(calls[0]?.init.body);
    const header = (calls[0]?.init.headers as Record<string, string>)['x-automate-signature'];
    const unix = Math.floor(new Date('2026-10-23T00:00:00.000Z').getTime() / 1000);
    expect(header).toBe(
      `t=${String(unix)},v1=${createHmac('sha256', secret)
        .update(`${String(unix)}.${body}`)
        .digest('hex')}`,
    );
    expect(signWebhook(secret, body, unix)).toBe(header);
    expect(calls[0]?.init.redirect).toBe('error');
  });

  it('sends nothing unsigned, nothing to a refused URL, and posts to Slack when configured', async () => {
    const fetcher = vi.fn();
    const alerts = [
      { kind: 'grade-dropped' as const, from: 'B' as const, to: 'C' as const, limiter: 'x' },
    ];
    expect(
      await deliverAlerts(
        { fetch: fetcher as unknown as typeof fetch },
        { webhookUrl: 'https://hooks.example.test' },
        { projectId: 'p', project: 'S', branch: 'main', detailsUrl: null, alerts },
      ),
    ).toEqual([]);
    expect(
      await deliverAlerts(
        { webhookSecret: 's'.repeat(40), fetch: fetcher as unknown as typeof fetch },
        { webhookUrl: 'https://127.0.0.1/x' },
        { projectId: 'p', project: 'S', branch: 'main', detailsUrl: null, alerts },
      ),
    ).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    const slack = fakeAdapter({});
    const outcomes = await deliverAlerts(
      { slack: { adapter: slack.adapter, token: 'xoxb' } },
      { slackChannel: '#quality' },
      {
        projectId: 'p',
        project: 'Service',
        branch: 'main',
        detailsUrl: 'https://a.test/r',
        alerts,
      },
    );
    expect(outcomes).toEqual(['slack grade-dropped: sent']);
    expect(slack.requests[0]?.input).toEqual({
      channel: '#quality',
      text: 'Service: health fell from B to C. x https://a.test/r',
    });
  });
});

describe('isAllowedWebhook', () => {
  it.each([
    ['https://hooks.slack.com/services/x', true],
    ['https://example.com/hook', true],
    ['http://example.com/hook', false],
    ['https://localhost/hook', false],
    ['https://127.0.0.1/hook', false],
    ['https://10.1.2.3/hook', false],
    ['https://172.20.0.1/hook', false],
    ['https://192.168.1.1/hook', false],
    ['https://169.254.169.254/latest', false],
    ['https://[::1]/hook', false],
    ['https://user:pass@example.com/hook', false],
    ['https://metadata.internal/x', false],
    ['not a url', false],
  ])('%s → %s', (url, allowed) => {
    expect(isAllowedWebhook(url)).toBe(allowed);
  });
});
