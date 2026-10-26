import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorAdapter, ConnectorRequest } from '@automate/connectors-sdk';
import {
  HEALTH_DIMENSIONS,
  type CanonicalFinding,
  type HealthGrade,
  type Scorecard,
} from '@automate/shared-contracts';
import {
  COMMENT_MARKER,
  aiGovernanceSection,
  alertsFor,
  evalsSection,
  deliverAlerts,
  doraLine,
  githubRepository,
  isAllowedWebhook,
  renderGateComment,
  reportToGitHub,
  signWebhook,
  testsSection,
  diffCoverageLine,
  lineRanges,
} from './health-integrations.js';
import type { AiGovernanceCheck } from './repo-health-service.js';

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

  const delivery = (status: Scorecard['status'], score: number | null): Scorecard => ({
    id: 'delivery',
    title: 'Software delivery (DORA)',
    dimension: 'delivery',
    evaluatedAt: '2026-10-23T12:00:00.000Z',
    windowDays: 30,
    status,
    score,
    cappedBy: score === null ? null : 'change-failure-rate',
    reasons: status === 'fail' ? ['Change failure rate is 30%.'] : [],
    metrics: [
      ['deployment-frequency', 'high'],
      ['change-lead-time', 'elite'],
      ['change-failure-rate', 'low'],
      ['failed-deployment-recovery-time', null],
      ['rework-rate', null],
    ].map(([key, band]) => ({
      key: key as string,
      label: key as string,
      value: band === null ? null : 1,
      unit: 'ratio' as const,
      direction: 'lower-better' as const,
      target: null,
      trend: null,
      sampleSize: 5,
      band: band ?? null,
      status: band === null ? ('insufficient' as const) : ('good' as const),
      summary: 's',
    })),
  });

  it('carries one DORA line when the delivery scorecard is measured', () => {
    const line = doraLine(delivery('fail', 52.4));
    expect(line).toBe(
      '**Delivery (DORA 2024):** 52.4 / 100, failing — deployment frequency high · lead time elite · change failure rate low · recovery time not enough data. Limited by change-failure-rate.',
    );
    const body = renderGateComment({ ...report, delivery: delivery('pass', 80) });
    expect(body.split('\n').filter((entry) => entry.startsWith('**Delivery'))).toHaveLength(1);
    expect(body).toContain('**Delivery (DORA 2024):** 80 / 100 — deployment frequency high');
  });

  it('leaves the DORA line out while there is too little data, or no scorecard', () => {
    expect(
      renderGateComment({ ...report, delivery: delivery('insufficient', null) }),
    ).not.toContain('DORA');
    expect(renderGateComment({ ...report, delivery: null })).not.toContain('DORA');
  });

  it('says which failures are quarantined, which are not, and which flaky tests nobody has', () => {
    const tests = {
      runId: 'r',
      total: 40,
      passed: 36,
      failed: 2,
      flaky: 2,
      reportErrors: 0,
      excused: false,
      quarantinedFailures: ['a.spec.ts › pays [webkit]'],
      failures: ['a.spec.ts › refunds`|'],
      flakyUnquarantined: ['b.spec.ts › lists'],
      unlabelledFailures: 0,
    };
    expect(testsSection(tests)).toEqual([
      '**Tests**',
      '',
      '40 tests: 36 passed, 2 failed, 2 flaky.',
      '- Failed: `a.spec.ts › refunds  `',
      '- Failed, quarantined: `a.spec.ts › pays [webkit]`',
      '- Flaky, not quarantined: `b.spec.ts › lists`',
    ]);
    const excused = testsSection({ ...tests, excused: true, failures: [], failed: 1 });
    expect(excused).toContain('- Failed, quarantined (excused): `a.spec.ts › pays [webkit]`');
    expect(testsSection({ ...tests, reportErrors: 2 })[3]).toBe(
      '- 2 error(s) outside the tests: nothing in this run is excused',
    );
    // One section in the comment, and none when there is no run for the commit.
    expect(renderGateComment({ ...report, tests })).toContain('**Tests**');
    expect(renderGateComment({ ...report, tests: null })).not.toContain('**Tests**');
    const many = testsSection({
      ...tests,
      failures: Array.from({ length: 12 }, (_, index) => `t${String(index)}`),
    });
    expect(many[3]).toMatch(/…and 2 more$/u);
    expect(testsSection({ ...tests, unlabelledFailures: 3 }).at(-1)).toBe(
      '- 3 failure(s) whose cause has no triage label',
    );
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
    // The boundaries of each refused range, from both sides.
    ['https://172.15.255.255/hook', true],
    ['https://172.16.0.1/hook', false],
    ['https://172.31.255.255/hook', false],
    ['https://172.32.0.1/hook', true],
    ['https://169.253.1.1/hook', true],
    ['https://169.254.0.1/hook', false],
    ['https://0.0.0.0/hook', false],
    ['https://11.0.0.1/hook', true],
    ['https://192.167.1.1/hook', true],
    ['https://api.localhost/hook', false],
    ['https://user@example.com/hook', false],
    ['https://[fc00::1]/hook', false],
    ['https://[fd12:3456::1]/hook', false],
    ['https://[fe80::1]/hook', false],
    ['https://[2001:db8::1]/hook', true],
    ['ftp://example.com/hook', false],
  ])('%s → %s', (url, allowed) => {
    expect(isAllowedWebhook(url)).toBe(allowed);
  });
});

describe('what a delivery reports when it cannot deliver', () => {
  const event = {
    projectId: 'p',
    project: 'Service',
    branch: 'main',
    detailsUrl: 'https://a.test/r',
    alerts: [
      {
        kind: 'new-critical' as const,
        findings: [
          { tool: 'semgrep', ruleId: 'r1', path: null, line: null },
          { tool: 'semgrep', ruleId: 'r2', path: 'src/a.ts', line: 3 },
        ],
      },
    ],
  };

  it('names a webhook failure rather than throwing, for an Error and for anything else', async () => {
    const transport = (fail: () => never) => ({
      webhookSecret: 's'.repeat(40),
      fetch: (async () => fail()) as unknown as typeof fetch,
    });
    expect(
      await deliverAlerts(
        transport(() => {
          throw new Error('connect ECONNREFUSED');
        }),
        { webhookUrl: 'https://hooks.example.test/x' },
        event,
      ),
    ).toEqual(['webhook: connect ECONNREFUSED']);
    expect(
      await deliverAlerts(
        transport(() => {
          throw 'not an error';
        }),
        { webhookUrl: 'https://hooks.example.test/x' },
        event,
      ),
    ).toEqual(['webhook: failed']);
  });

  it('names the Slack refusal, and words a critical with no path and with several findings', async () => {
    const slack = fakeAdapter({}, ['postMessage']);
    expect(
      await deliverAlerts(
        { slack: { adapter: slack.adapter, token: 'xoxb' } },
        { slackChannel: '#quality' },
        event,
      ),
    ).toEqual(['slack new-critical: github_403']);
    expect(slack.requests[0]?.input).toEqual({
      channel: '#quality',
      text: 'Service: 2 new critical findings — semgrep: r1. https://a.test/r',
    });
    const one = fakeAdapter({});
    await deliverAlerts(
      { slack: { adapter: one.adapter, token: 'xoxb' } },
      { slackChannel: '#quality' },
      {
        ...event,
        detailsUrl: null,
        alerts: [
          { kind: 'new-critical', findings: [{ tool: 't', ruleId: 'r', path: 'p.ts', line: 1 }] },
        ],
      },
    );
    expect(one.requests[0]?.input).toMatchObject({
      text: 'Service: 1 new critical finding — t: r in p.ts.',
    });
  });

  it('sends nothing when there is nothing to alert', async () => {
    const slack = fakeAdapter({});
    expect(
      await deliverAlerts(
        { slack: { adapter: slack.adapter, token: 'xoxb' } },
        { slackChannel: '#quality' },
        { ...event, alerts: [] },
      ),
    ).toEqual([]);
    expect(slack.requests).toEqual([]);
  });
});

describe('the gate status and comment when GitHub refuses part of it', () => {
  const report = {
    verdict: {
      verdict: 'passed' as const,
      reasons: [],
      newFindings: { critical: 0, high: 0, total: 0 },
    },
    grade: grade(null),
    added: [],
    branch: 'feature',
    detailsUrl: 'https://automate.example/dashboard/repo/p',
  };
  const target = { owner: 'o', repo: 'r', sha: 'abc1234', pullRequest: 3 };

  it('describes an incomplete grade, and links the status to the dashboard', async () => {
    const github = fakeAdapter({ listIssueComments: [] });
    await reportToGitHub(github.adapter, 't', target, report);
    expect(github.requests[0]?.input).toMatchObject({
      description: 'Grade incomplete',
      target_url: 'https://automate.example/dashboard/repo/p',
    });
  });

  it('reports a failed comment write with its code, and a status refusal without a pull request', async () => {
    const writeRefused = fakeAdapter({ listIssueComments: [] }, ['createIssueComment']);
    expect(await reportToGitHub(writeRefused.adapter, 't', target, report)).toEqual({
      status: true,
      comment: 'failed',
      error: 'github_403',
    });
    const statusRefused = fakeAdapter({}, ['createCommitStatus']);
    expect(
      await reportToGitHub(
        statusRefused.adapter,
        't',
        { owner: 'o', repo: 'r', sha: 'abc1234' },
        report,
      ),
    ).toEqual({ status: false, comment: 'skipped', error: 'github_403' });
  });

  it('creates a comment when the listing is not one it can read', async () => {
    const unreadable = fakeAdapter({ listIssueComments: { not: 'a list' } });
    expect((await reportToGitHub(unreadable.adapter, 't', target, report)).comment).toBe('created');
  });
});

describe('the diff-coverage line of the gate comment', () => {
  it('collapses consecutive lines into ranges', () => {
    expect(lineRanges([9, 3, 4, 5, 5, 11, 12])).toEqual(['3-5', '9', '11-12']);
    expect(lineRanges([])).toEqual([]);
  });

  it('lists at most ten uncovered ranges, and says how many more there are', () => {
    const uncovered = Array.from({ length: 12 }, (_, index) => ({
      path: `src/f${String(index)}.ts`,
      lines: [1],
    }));
    const line = diffCoverageLine({
      covered: 8,
      executable: 20,
      ratio: 0.4,
      uncovered,
      unmeasuredFiles: [],
      computedAt: '2026-10-23T12:00:00.000Z',
    });
    expect(line).toContain('**Diff coverage:** 40.0% — 8 of 20 changed executable lines ran.');
    expect(line).toContain('`src/f9.ts:1`, …and 2 more.');
    expect(line).not.toContain('src/f10.ts');
  });

  it('says there is nothing to measure when no changed line is executable', () => {
    expect(
      diffCoverageLine({
        covered: 0,
        executable: 0,
        ratio: null,
        uncovered: [],
        unmeasuredFiles: ['README.md'],
        computedAt: '2026-10-23T12:00:00.000Z',
      }),
    ).toMatch(/nothing to measure/u);
  });
});

describe('the AI governance section of the gate comment', () => {
  const plain = {
    verdict: {
      verdict: 'passed' as const,
      reasons: [],
      newFindings: { critical: 0, high: 0, total: 0 },
    },
    grade: grade('B'),
    added: [],
    branch: 'feature/x',
    detailsUrl: null,
  };
  const check = (extra: Partial<AiGovernanceCheck> = {}): AiGovernanceCheck => ({
    pullRequest: 7,
    synced: true,
    attribution: 'agent-authored',
    agent: 'claude-code',
    confidence: 0.95,
    signals: [{ kind: 'bot-login', detail: 'author claude[bot] is claude-code' }],
    unknownReason: null,
    verdict: {
      applies: true,
      verdict: 'fail',
      reasons: [
        'Agent-authored change by claude-code needs at least one human approval; it has none.',
      ],
      attributionNote: null,
    },
    ...extra,
  });

  it('shows the attribution, its confidence and signals, the verdict and each reason', () => {
    const body = renderGateComment({ ...plain, aiGovernance: check() });
    expect(body).toContain('**AI governance**');
    expect(body).toContain(
      'Attribution: agent-authored (claude-code), 95% confidence — author claude[bot] is claude-code.',
    );
    expect(body).toContain('Rules: failed.');
    expect(body).toContain(
      '- Agent-authored change by claude-code needs at least one human approval; it has none.',
    );
  });

  it('says why attribution is unknown for a pull request the sync never read, with the note', () => {
    const lines = aiGovernanceSection(
      check({
        synced: false,
        attribution: 'unknown',
        agent: null,
        confidence: 0,
        signals: [],
        unknownReason: 'Delivery sync is off for this project.',
        verdict: {
          applies: false,
          verdict: 'not-applicable',
          reasons: [],
          attributionNote: 'Attribution was unknown; the change was treated as human.',
        },
      }),
    );
    expect(lines).toEqual([
      '**AI governance**',
      '',
      'Attribution: unknown, 0% confidence.',
      '',
      '_Delivery sync is off for this project._',
      '',
      'Rules: not applicable — the rules govern AI-written change only.',
      '',
      '_Attribution was unknown; the change was treated as human._',
    ]);
  });

  it('keeps a label’s text from breaking the Markdown, and shows at most five signals', () => {
    const signals = Array.from({ length: 7 }, (_, index) => ({
      kind: 'label' as const,
      detail: `label "a|b\`${String(index)}" marks agent-authored change`,
    }));
    const [, , line] = aiGovernanceSection(check({ signals }));
    expect(line).not.toMatch(/[|`]/u);
    expect(line).toContain('…and 2 more');
  });

  it('has no section when the rules were not read', () => {
    expect(renderGateComment(plain)).not.toContain('AI governance');
  });
});

describe('the Evals section of the gate comment', () => {
  const suites = [
    {
      suite: 'support|bot',
      verdict: 'fail' as const,
      reasons: ['Pass rate fell.'],
      regressions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      flaky: ['h'],
      commitSha: 'abc1234',
      fellBack: false,
    },
    {
      suite: 'router',
      verdict: 'insufficient' as const,
      reasons: [],
      regressions: [],
      flaky: [],
      commitSha: null,
      fellBack: false,
    },
  ];
  const reading = (gateOnEvals: boolean, list = suites) => ({
    gateOnEvals,
    suites: list,
    commit: null,
    onDefaultBranch: false,
  });

  it('names each suite with its verdict, its significant regressions and its flaky cases', () => {
    expect(evalsSection(reading(true))).toEqual([
      '**Evals**',
      '',
      '- `support bot`: failed',
      '  - Significant regressions: `a`, `b`, `c`, `d`, `e` …and 2 more',
      '  - Flaky: `h`',
      '- `router`: not enough attempts to tell',
    ]);
  });

  it('says when the policy only reports evals, and appears in the comment only with a suite', () => {
    expect(evalsSection(reading(false))[2]).toContain('Reported only');
    const base = {
      verdict: {
        verdict: 'passed' as const,
        reasons: [],
        newFindings: { critical: 0, high: 0, total: 0 },
      },
      grade: grade('B'),
      added: [],
      branch: 'feature',
      detailsUrl: null,
    };
    expect(renderGateComment({ ...base, evals: reading(true) })).toContain('**Evals**');
    expect(renderGateComment({ ...base, evals: reading(true, []) })).not.toContain('**Evals**');
    expect(renderGateComment(base)).not.toContain('**Evals**');
  });

  it('names a missing suite, one with no baseline, and a run read from another commit', () => {
    const lines = evalsSection({
      gateOnEvals: true,
      commit: 'ccccccc3',
      onDefaultBranch: false,
      suites: [
        {
          suite: 'planner',
          verdict: 'missing',
          reasons: [],
          regressions: [],
          flaky: [],
          commitSha: null,
          fellBack: false,
        },
        {
          suite: 'support',
          verdict: 'no-baseline',
          reasons: [],
          regressions: [],
          flaky: [],
          commitSha: 'bbbbbbb2',
          fellBack: true,
        },
      ],
    });
    expect(lines.slice(2)).toEqual([
      '- `planner`: runs on the default branch, not run on this branch',
      '- `support`: no baseline on the default branch',
      "  - No run on `ccccccc3`; fell back to the branch's latest run (`bbbbbbb2`)",
    ]);
  });
});
