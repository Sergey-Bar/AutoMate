import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  HEALTH_DIMENSIONS,
  isOptInDimension,
  type DimensionScore,
  type HealthFinding,
  type HealthGrade,
  type PortfolioEntry,
  type ProjectHealth,
} from '@automate/shared-contracts';
import type { HealthClient } from '../lib/health-client.js';
import { ago, letterTone, meterVariant, notMeasured, whatIsGood } from '../lib/health-view.js';
import { Portfolio, needsAttention, worstFirst } from './Portfolio.js';
import { RepoHealth } from './RepoHealth.js';
import { AccessGate, AccessPage } from './Access.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';

function dimension(
  overrides: Partial<DimensionScore> & Pick<DimensionScore, 'dimension'>,
): DimensionScore {
  return {
    measured: false,
    score: null,
    letter: null,
    weight: isOptInDimension(overrides.dimension) ? 0 : 10,
    tools: [],
    openFindings: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    summary: [],
    ...overrides,
  };
}

function grade(overrides: Partial<HealthGrade> = {}): HealthGrade {
  return {
    score: 69,
    letter: 'D',
    incomplete: false,
    incompleteReason: null,
    cappedBy: 'open-secret',
    cappingValue: 69,
    limiter: 'Capped at D — 1 open secret in the repository',
    dimensions: HEALTH_DIMENSIONS.map((name) =>
      name === 'security'
        ? dimension({
            dimension: name,
            measured: true,
            score: 92.8,
            letter: 'A',
            summary: ['1 medium open from semgrep'],
            tools: [{ name: 'semgrep', version: '1.90.0' }],
          })
        : name === 'code-quality'
          ? dimension({
              dimension: name,
              measured: true,
              score: 64,
              letter: 'F',
              summary: ['9.0% of lines duplicated'],
            })
          : dimension({ dimension: name }),
    ),
    gates: [
      {
        id: 'open-secret',
        tripped: true,
        enabled: true,
        statement: '1 open secret in the repository',
      },
      {
        id: 'fixable-critical-vulnerability',
        tripped: false,
        enabled: true,
        statement: 'No critical vulnerability with a fix available',
      },
      {
        id: 'failing-tests',
        tripped: false,
        enabled: false,
        statement: 'No failing tests on the default branch',
      },
    ],
    fixNext: [
      {
        key: 'gate:open-secret',
        dimension: 'security',
        title: 'Resolve 1 open secret in the repository',
        findings: 1,
        gain: 21.4,
        helpUri: 'https://example.test/rule',
      },
    ],
    ...overrides,
  };
}

const FINDING: HealthFinding = {
  id: '22222222-2222-4222-8222-222222222222',
  branch: 'main',
  fingerprint: 'fp',
  tool: 'gitleaks',
  ruleId: 'generic-api-key',
  kind: 'secret',
  severity: 'high',
  dimension: 'security',
  path: 'config/app.env',
  line: 3,
  message: 'generic-api-key has detected secret',
  helpUri: null,
  fixAvailable: null,
  state: 'open',
  triageReason: null,
  triageExpiresAt: null,
  triagedBy: null,
  owner: '@team/platform',
  firstSeenAt: '2026-10-20T00:00:00.000Z',
  lastSeenAt: '2026-10-23T00:00:00.000Z',
};

function health(value: Partial<ProjectHealth> = {}): ProjectHealth {
  return {
    projectId: PROJECT,
    name: 'Service',
    branch: 'main',
    evaluatedAt: '2026-10-23T12:00:00.000Z',
    grade: grade(),
    reports: [
      {
        id: 'r1',
        format: 'sarif',
        source: 'ci',
        toolKey: 'sarif:gitleaks',
        tools: [{ name: 'gitleaks', version: '8.21.2' }],
        commitSha: 'abcdef1234',
        findingCount: 1,
        receivedAt: '2026-10-23T11:00:00.000Z',
      },
    ],
    ...value,
  };
}

function client(overrides: Partial<HealthClient> = {}): HealthClient {
  return {
    getPortfolio: vi.fn(async () => ({ projects: [] })),
    getHeatmap: vi.fn(async () => Promise.reject(new Error('not stubbed'))),
    getTestEffectiveness: vi.fn(async () => Promise.reject(new Error('not stubbed'))),
    getHealth: vi.fn(async () => health()),
    getFindings: vi.fn(async () => ({ findings: [FINDING], total: 1, offset: 0, limit: 25 })),
    getHistory: vi.fn(async () => ({ projectId: PROJECT, branch: 'main', points: [] })),
    triage: vi.fn(async () => ({ ...FINDING, state: 'accepted' as const })),
    startScan: vi.fn(async () => ({
      runIds: ['run-1'],
      scanners: ['gitleaks', 'semgrep'],
      notConfigured: ['trivy'],
    })),
    whoami: vi.fn(async () => ({
      actor: 'anonymous',
      role: 'admin' as const,
      mode: 'open' as const,
    })),
    getSettings: vi.fn(async () => ({
      alerts: { slackChannel: '#quality' },
      schedule: null,
      codeowners: true,
    })),
    setSchedule: vi.fn(async (_id: string, cadence: 'daily' | 'weekly' | null) => ({
      cadence,
      scanners: ['gitleaks'],
    })),
    setAlerts: vi.fn(async () => undefined),
    issuePairingCode: vi.fn(async () => ({
      id: 'p1',
      code: '042137',
      deviceName: 'Phone',
      role: 'viewer' as const,
      expiresAt: '2026-10-23T00:10:00.000Z',
      pairUrl: 'https://automate.local/dashboard/pair?code=042137',
    })),
    pair: vi.fn(async () => ({ role: 'viewer' as const, deviceName: 'Phone' })),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    listTokens: vi.fn(async () => []),
    createToken: vi.fn(async () => ({
      token: 'amt_issued-once',
      summary: {
        id: 't1',
        name: 'Ana',
        role: 'viewer' as const,
        projectId: null,
        displayPrefix: 'amt_issue',
        createdBy: 'session',
        createdAt: '2026-10-23T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    })),
    revokeToken: vi.fn(async () => ({
      id: 't1',
      name: 'Ana',
      role: 'viewer' as const,
      projectId: null,
      displayPrefix: 'amt_issue',
      createdBy: 'session',
      createdAt: '2026-10-23T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: '2026-10-24T00:00:00.000Z',
    })),
    ...overrides,
  };
}

describe('RepoHealth', () => {
  it('leads with the letter and the sentence that limits it', async () => {
    render(<RepoHealth health={client()} projectId={PROJECT} />);
    await screen.findByTestId('repo-health');
    expect(screen.getByRole('heading', { level: 1, name: 'Service' })).toBeInTheDocument();
    expect(screen.getByTestId('repo-health-360')).toHaveAttribute(
      'href',
      `/dashboard/repo/${PROJECT}/overview`,
    );
    expect(screen.getByTestId('health-letter')).toHaveTextContent('D');
    expect(screen.getByTestId('health-score')).toHaveTextContent('69 / 100');
    expect(screen.getByTestId('health-limiter')).toHaveTextContent(
      'Capped at D — 1 open secret in the repository',
    );
    expect(screen.getByTestId('gate-failing-tests')).toHaveTextContent('disabled by policy');
  });

  it('shows every dimension, and says which were not measured', async () => {
    render(<RepoHealth health={client()} projectId={PROJECT} />);
    await screen.findByTestId('repo-health');
    expect(screen.getByTestId('dimension-security')).toHaveAttribute('data-measured', 'true');
    expect(screen.getByTestId('dimension-coverage')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('dimension-coverage')).toHaveTextContent('Not measured');
    expect(screen.getByTestId('not-measured')).toHaveTextContent(
      'Tests, Dependencies, Coverage, Supply chain, Runtime',
    );
    // The opt-in dimensions are a row of their own, and an unweighted one is not "missing".
    expect(screen.getByTestId('not-measured')).not.toHaveTextContent('Delivery');
    const optIn = screen.getByTestId('opt-in-dimensions');
    expect(within(optIn).getByTestId('dimension-delivery')).toHaveTextContent('Opt-in');
    expect(screen.getByTestId('core-dimensions')).not.toContainElement(
      screen.getByTestId('dimension-delivery'),
    );
    expect(
      within(screen.getByTestId('fix-next')).getByRole('link', {
        name: 'Resolve 1 open secret in the repository',
      }),
    ).toHaveAttribute('href', 'https://example.test/rule');
    expect(screen.getByTestId('fix-gate:open-secret')).toHaveTextContent('+21.4');
  });

  it('says incomplete rather than printing a letter', async () => {
    const incomplete = health({
      grade: grade({
        score: null,
        letter: null,
        incomplete: true,
        incompleteReason: 'Security has not been measured',
        cappedBy: null,
        cappingValue: null,
        limiter: null,
        fixNext: [],
      }),
    });
    render(
      <RepoHealth
        health={client({ getHealth: vi.fn(async () => incomplete) })}
        projectId={PROJECT}
      />,
    );
    await screen.findByTestId('repo-health');
    expect(screen.getByTestId('health-letter')).toHaveTextContent('—');
    expect(screen.getByTestId('health-score')).toHaveTextContent('incomplete');
    expect(screen.getByTestId('health-limiter')).toHaveTextContent(
      'Security has not been measured',
    );
  });

  it('renders the server’s own sentence when the read fails', async () => {
    const failing = client({
      getHealth: vi.fn(async () =>
        Promise.reject(Object.assign(new Error('API answered 404'), { detail: 'No project x' })),
      ),
    });
    render(<RepoHealth health={failing} projectId={PROJECT} />);
    expect(await screen.findByText('No project x')).toBeInTheDocument();
  });

  it('opens a finding and records a triage decision with a reason and an expiry', async () => {
    const user = userEvent.setup();
    const api = client();
    render(<RepoHealth health={api} projectId={PROJECT} />);
    await user.click(await screen.findByRole('button', { name: 'generic-api-key' }));
    const drawer = await screen.findByTestId('finding-drawer');
    await user.type(within(drawer).getByLabelText('Reason'), 'rotated, history purge pending');
    fireEvent.change(within(drawer).getByLabelText('Expires (required)'), {
      target: { value: '2026-11-30' },
    });
    await user.click(within(drawer).getByTestId('triage-submit'));
    await waitFor(() =>
      expect(api.triage).toHaveBeenCalledWith(PROJECT, FINDING.id, {
        state: 'accepted',
        reason: 'rotated, history purge pending',
        expiresAt: '2026-11-30T00:00:00.000Z',
      }),
    );
  });

  it('filters findings and resets to the first page', async () => {
    const api = client();
    render(<RepoHealth health={api} projectId={PROJECT} />);
    await screen.findByTestId('findings-range');
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'critical' } });
    await waitFor(() =>
      expect(api.getFindings).toHaveBeenLastCalledWith(
        PROJECT,
        expect.objectContaining({ severity: 'critical', state: 'open', offset: 0 }),
      ),
    );
  });

  it('starts a scan and names the scanners that are not installed', async () => {
    const user = userEvent.setup();
    const api = client();
    render(<RepoHealth health={api} projectId={PROJECT} />);
    await user.click(await screen.findByTestId('health-scan'));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Scanning with gitleaks, semgrep · not installed: trivy',
    );
    expect(api.startScan).toHaveBeenCalledWith(PROJECT);
  });
});

function entry(overrides: Partial<PortfolioEntry>): PortfolioEntry {
  return {
    projectId: PROJECT,
    name: 'Service',
    slug: 'service',
    branch: 'main',
    score: 91,
    letter: 'A',
    incomplete: false,
    limiter: 'Limited by Coverage — 71.0% of lines covered',
    worst: 'coverage',
    trend: 2.5,
    lastReportAt: '2026-10-23T11:00:00.000Z',
    ...overrides,
  };
}

describe('Portfolio', () => {
  it('lists repositories worst first, with the count that needs attention', async () => {
    const projects = [
      entry({}),
      entry({
        projectId: 'b',
        name: 'Billing',
        slug: 'billing',
        letter: 'F',
        score: 40,
        trend: -3,
      }),
      entry({
        projectId: 'c',
        name: 'Docs',
        slug: 'docs',
        letter: null,
        score: null,
        incomplete: true,
        trend: null,
        worst: null,
        limiter: null,
      }),
    ];
    render(<Portfolio health={client({ getPortfolio: vi.fn(async () => ({ projects })) })} />);
    await screen.findByTestId('portfolio');
    expect(screen.getByTestId('portfolio-attention')).toHaveTextContent('2');
    const rows = within(screen.getByTestId('portfolio-table')).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Docs',
      'Billing',
      'Service',
    ]);
    expect(within(rows[2] as HTMLElement).getByRole('link', { name: 'Service' })).toHaveAttribute(
      'href',
      `/dashboard/repo/${PROJECT}`,
    );
    expect(rows[1]).toHaveTextContent('-3.0');
  });

  it('says how to start when nothing is registered', async () => {
    render(<Portfolio health={client()} />);
    expect(await screen.findByTestId('portfolio-empty')).toBeInTheDocument();
  });
});

describe('schedule and alerts', () => {
  it('turns on a daily scan and saves the alert targets', async () => {
    const user = userEvent.setup();
    const api = client();
    render(<RepoHealth health={api} projectId={PROJECT} />);
    const panel = await screen.findByTestId('health-settings');
    await waitFor(() =>
      expect(within(panel).getByLabelText('Slack channel')).toHaveValue('#quality'),
    );
    await user.click(within(panel).getByRole('button', { name: 'Daily' }));
    expect(await within(panel).findByRole('status')).toHaveTextContent(
      'Scanning daily with gitleaks',
    );
    await user.type(
      within(panel).getByLabelText('Webhook (https, signed)'),
      'https://hooks.example.test/a',
    );
    await user.click(within(panel).getByRole('button', { name: 'Save alerts' }));
    await waitFor(() =>
      expect(api.setAlerts).toHaveBeenCalledWith(PROJECT, {
        slackChannel: '#quality',
        webhookUrl: 'https://hooks.example.test/a',
      }),
    );
    expect(api.setSchedule).toHaveBeenCalledWith(PROJECT, 'daily');
  });
});

describe('AccessGate and AccessPage', () => {
  it('asks for a credential when the caller has no role, and renders the page once signed in', async () => {
    const user = userEvent.setup();
    let role: 'viewer' | null = null;
    const api = client({
      whoami: vi.fn(async () => ({ actor: 'anonymous', role, mode: 'enforced' as const })),
      signIn: vi.fn(async () => {
        role = 'viewer';
      }),
    });
    render(<AccessGate health={api}>{(who) => <p>inside as {who.role}</p>}</AccessGate>);
    await screen.findByTestId('sign-in');
    await user.type(screen.getByLabelText('Token or key'), 'amt_abc');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('inside as viewer')).toBeInTheDocument();
    expect(api.signIn).toHaveBeenCalledWith('amt_abc');
  });

  it('shows the server’s refusal on a failed sign-in', async () => {
    const user = userEvent.setup();
    const api = client({
      whoami: vi.fn(async () => ({ actor: 'anonymous', role: null, mode: 'enforced' as const })),
      signIn: vi.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { detail: 'Invalid credentials' })),
      ),
    });
    render(<AccessGate health={api}>{() => <p>never</p>}</AccessGate>);
    await user.type(await screen.findByLabelText('Token or key'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  });

  it('issues a token, shows it once, and revokes one', async () => {
    const user = userEvent.setup();
    const live = {
      id: 't1',
      name: 'Ana',
      role: 'viewer' as const,
      projectId: null,
      displayPrefix: 'amt_issue',
      createdBy: 'session',
      createdAt: '2026-10-23T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
    };
    const api = client({ listTokens: vi.fn(async () => [live]) });
    render(<AccessPage health={api} />);
    await screen.findByTestId('access-page');
    expect(screen.getByTestId('access-open')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Issue' }));
    expect(await screen.findByTestId('issued-token')).toHaveTextContent('amt_issued-once');
    expect(api.createToken).toHaveBeenCalledWith({ name: 'Ana', role: 'viewer' });
    await user.click(
      within(await screen.findByTestId('token-t1')).getByRole('button', { name: 'Revoke' }),
    );
    expect(api.revokeToken).toHaveBeenCalledWith('t1');
  });
});

describe('health view helpers', () => {
  it('ranks worst first and flags attention', () => {
    expect(worstFirst(entry({ letter: 'B' }), entry({ letter: 'C' }))).toBeGreaterThan(0);
    expect(needsAttention(entry({ letter: 'C' }))).toBe(true);
    expect(needsAttention(entry({ letter: 'B' }))).toBe(false);
  });

  it('tones letters as verdicts and reads what is good', () => {
    expect(letterTone('A+')).toBe('text-success');
    expect(letterTone('F')).toBe('text-danger');
    expect(letterTone(null)).toBe('text-fg-muted');
    expect(whatIsGood(grade())).toEqual([
      'Security A — 1 medium open from semgrep',
      'No critical vulnerability with a fix available',
    ]);
    expect(notMeasured(grade())).toHaveLength(5);
  });

  it('says how long ago, coarsely', () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    expect(ago(null, now)).toBe('never');
    expect(ago('2026-10-23T11:59:30.000Z', now)).toBe('30 seconds ago');
    expect(ago('2026-10-23T11:00:00.000Z', now)).toBe('1 hour ago');
    expect(ago('2026-10-20T12:00:00.000Z', now)).toBe('3 days ago');
    expect(ago('2024-10-23T12:00:00.000Z', now)).toBe('2 years ago');
  });
});

describe('RepoHealth, the edges', () => {
  const many = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, index) => ({
      ...FINDING,
      id: `id-${String(offset + index)}`,
      ruleId: `rule-${String(offset + index)}`,
    }));

  it('pages through findings with Next and Previous, and says the range', async () => {
    const user = userEvent.setup();
    const api = client({
      getFindings: vi.fn(async (_id: string, query?: { offset?: number }) => ({
        findings: many(25, query?.offset ?? 0),
        total: 30,
        offset: query?.offset ?? 0,
        limit: 25,
      })),
    });
    render(<RepoHealth health={api} projectId={PROJECT} />);
    expect(await screen.findByTestId('findings-range')).toHaveTextContent('1–25 of 30');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(screen.getByTestId('findings-range')).toHaveTextContent('26–50 of 30'),
    );
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() =>
      expect(screen.getByTestId('findings-range')).toHaveTextContent('1–25 of 30'),
    );
  });

  it('says so when no finding matches, and when the findings read fails', async () => {
    const empty = client({
      getFindings: vi.fn(async () => ({ findings: [], total: 0, offset: 0, limit: 25 })),
    });
    const { unmount } = render(<RepoHealth health={empty} projectId={PROJECT} />);
    expect(await screen.findByTestId('findings-empty')).toBeInTheDocument();
    unmount();
    const failing = client({
      getFindings: vi.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { detail: 'findings unavailable' })),
      ),
    });
    render(<RepoHealth health={failing} projectId={PROJECT} />);
    expect(await screen.findByText('findings unavailable')).toBeInTheDocument();
  });

  it('names the reason a scan could not start', async () => {
    const user = userEvent.setup();
    const api = client({
      startScan: vi.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { detail: 'nothing to scan' })),
      ),
    });
    render(<RepoHealth health={api} projectId={PROJECT} />);
    await user.click(await screen.findByTestId('health-scan'));
    expect(await screen.findByRole('status')).toHaveTextContent('nothing to scan');
  });

  it('re-reads the grade on a timer after a scan starts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = client();
      render(<RepoHealth health={api} projectId={PROJECT} />);
      fireEvent.click(await screen.findByTestId('health-scan'));
      await waitFor(() => expect(api.startScan).toHaveBeenCalled());
      const before = vi.mocked(api.getHealth).mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_500);
      await waitFor(() =>
        expect(vi.mocked(api.getHealth).mock.calls.length).toBeGreaterThan(before),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('reopens a decided finding, shows the decision, and shows a refused save', async () => {
    const user = userEvent.setup();
    const decided = {
      ...FINDING,
      state: 'accepted' as const,
      triageReason: 'vendor fix due',
      triageExpiresAt: '2026-12-01T00:00:00.000Z',
      helpUri: 'https://rules.test/x',
      line: null,
      path: null,
      owner: null,
    };
    const api = client({
      getFindings: vi.fn(async () => ({ findings: [decided], total: 1, offset: 0, limit: 25 })),
      triage: vi.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { detail: 'This needs the operator role' })),
      ),
    });
    render(<RepoHealth health={api} projectId={PROJECT} />);
    await user.click(await screen.findByRole('button', { name: 'generic-api-key' }));
    const drawer = await screen.findByTestId('finding-drawer');
    expect(drawer).toHaveTextContent('vendor fix due · until 2026-12-01');
    expect(drawer).toHaveTextContent('Unowned');
    expect(within(drawer).getByRole('link', { name: /rule's own documentation/u })).toHaveAttribute(
      'href',
      'https://rules.test/x',
    );
    expect(within(drawer).queryByLabelText('Reason')).toBeNull();
    await user.click(within(drawer).getByTestId('triage-submit'));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'This needs the operator role',
    );
    expect(api.triage).toHaveBeenCalledWith(PROJECT, decided.id, { state: 'open' });
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('finding-drawer')).toBeNull());
  });

  it('suppresses without an expiry, and reloads after a saved decision', async () => {
    const user = userEvent.setup();
    const api = client();
    render(<RepoHealth health={api} projectId={PROJECT} />);
    await user.click(await screen.findByRole('button', { name: 'generic-api-key' }));
    const drawer = await screen.findByTestId('finding-drawer');
    fireEvent.change(within(drawer).getByLabelText('Decision'), {
      target: { value: 'suppressed' },
    });
    await user.type(within(drawer).getByLabelText('Reason'), 'test fixture');
    expect(within(drawer).getByLabelText('Expires (optional)')).toBeInTheDocument();
    await user.click(within(drawer).getByTestId('triage-submit'));
    await waitFor(() =>
      expect(api.triage).toHaveBeenCalledWith(PROJECT, FINDING.id, {
        state: 'suppressed',
        reason: 'test fixture',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('finding-drawer')).toBeNull());
  });

  it('shows how to send the first report, and a history sparkline once there are readings', async () => {
    const api = client({
      getHealth: vi.fn(async () => health({ reports: [] })),
      getHistory: vi.fn(async () => ({
        projectId: PROJECT,
        branch: 'main',
        points: [
          { at: '2026-10-20T00:00:00.000Z', score: 60, letter: 'D' as const, dimensions: {} },
          { at: '2026-10-21T00:00:00.000Z', score: null, letter: null, dimensions: {} },
          { at: '2026-10-22T00:00:00.000Z', score: 70, letter: 'C' as const, dimensions: {} },
        ],
      })),
    });
    render(<RepoHealth health={api} projectId={PROJECT} />);
    expect(await screen.findByTestId('health-reports')).toHaveTextContent(
      `/api/v1/projects/${PROJECT}/health/reports`,
    );
    expect(screen.getByTestId('repo-health-subject')).toHaveTextContent('no reports yet');
    expect(
      await screen.findByRole('img', { name: /Health score over 90 days.*2 readings/u }),
    ).toBeInTheDocument();
  });

  it('says nothing is holding the grade down, and nothing is at A yet, when that is true', async () => {
    const plain = grade({
      fixNext: [],
      dimensions: HEALTH_DIMENSIONS.map((name) =>
        dimension({ dimension: name, measured: true, score: 85, letter: 'B', summary: ['ok'] }),
      ),
      gates: [],
    });
    render(
      <RepoHealth
        health={client({ getHealth: vi.fn(async () => health({ grade: plain })) })}
        projectId={PROJECT}
      />,
    );
    expect(
      await screen.findByText('Nothing measured is holding the grade down.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Nothing is at A yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('not-measured')).toBeNull();
  });

  it('turns the schedule off, reports a refused save, and shows a settings read failure', async () => {
    const user = userEvent.setup();
    const api = client({
      getSettings: vi.fn(async () => ({
        alerts: {},
        schedule: 'daily' as const,
        codeowners: false,
      })),
      setAlerts: vi.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { detail: 'webhook not allowed' })),
      ),
    });
    const { unmount } = render(<RepoHealth health={api} projectId={PROJECT} />);
    const panel = await screen.findByTestId('health-settings');
    await user.click(within(panel).getByRole('button', { name: 'Off' }));
    expect(await within(panel).findByRole('status')).toHaveTextContent('Scheduled scans are off.');
    await user.click(within(panel).getByRole('button', { name: 'Save alerts' }));
    await waitFor(() =>
      expect(within(panel).getByRole('status')).toHaveTextContent('webhook not allowed'),
    );
    expect(api.setAlerts).toHaveBeenCalledWith(PROJECT, { slackChannel: null, webhookUrl: null });
    unmount();
    render(
      <RepoHealth
        health={client({
          getSettings: vi.fn(async () => Promise.reject(new Error('settings down'))),
        })}
        projectId={PROJECT}
      />,
    );
    expect(await screen.findByText('settings down')).toBeInTheDocument();
  });
});

describe('Portfolio and Access, the edges', () => {
  it('shows a portfolio read failure', async () => {
    render(
      <Portfolio
        health={client({
          getPortfolio: vi.fn(async () =>
            Promise.reject(Object.assign(new Error('x'), { detail: 'no database' })),
          ),
        })}
      />,
    );
    expect(await screen.findByText('no database')).toBeInTheDocument();
  });

  it('marks a flat trend and an incomplete row', async () => {
    const projects = [
      entry({ trend: 0 }),
      entry({
        projectId: 'b',
        slug: 'b',
        name: 'B',
        letter: null,
        score: null,
        incomplete: true,
        trend: null,
        worst: null,
        limiter: null,
        lastReportAt: null,
      }),
    ];
    render(<Portfolio health={client({ getPortfolio: vi.fn(async () => ({ projects })) })} />);
    const table = await screen.findByTestId('portfolio-table');
    expect(within(table).getByTestId('portfolio-row-b')).toHaveTextContent('incomplete');
    expect(within(table).getByTestId('portfolio-row-b')).toHaveTextContent('No report yet');
    expect(within(table).getByTestId('portfolio-row-service')).toHaveTextContent('0.0');
  });

  it('says when the API cannot be reached, and when no token has been issued', async () => {
    const { unmount } = render(
      <AccessGate
        health={client({ whoami: vi.fn(async () => Promise.reject(new Error('offline'))) })}
      >
        {() => <p>x</p>}
      </AccessGate>,
    );
    expect(await screen.findByText('offline')).toBeInTheDocument();
    unmount();
    render(
      <AccessPage
        health={client({
          whoami: vi.fn(async () => ({
            actor: 'session',
            role: 'admin' as const,
            mode: 'enforced' as const,
          })),
        })}
      />,
    );
    expect(await screen.findByText('No token has been issued.')).toBeInTheDocument();
    expect(screen.queryByTestId('access-open')).toBeNull();
  });

  it('pins an uploader to a project, shows a refused issue, a revoked token, and a list failure', async () => {
    const user = userEvent.setup();
    const revoked = {
      id: 't2',
      name: 'old',
      role: 'admin' as const,
      projectId: null,
      displayPrefix: 'amt_old',
      createdBy: 's',
      createdAt: 'x',
      lastUsedAt: '2026-10-23T00:00:00.000Z',
      revokedAt: '2026-10-24T00:00:00.000Z',
    };
    const api = client({
      listTokens: vi.fn(async () => [revoked]),
      createToken: vi.fn(async () =>
        Promise.reject(
          Object.assign(new Error('x'), { detail: 'an uploader token is pinned to one project' }),
        ),
      ),
    });
    const { unmount } = render(<AccessPage health={api} />);
    expect(await screen.findByTestId('token-t2')).toHaveTextContent('admin · revoked');
    expect(
      within(screen.getByTestId('token-t2')).queryByRole('button', { name: 'Revoke' }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'uploader' } });
    const projectField = screen.getByLabelText('Project id (required)');
    expect(projectField).toBeEnabled();
    await user.type(screen.getByLabelText('Name'), 'ci');
    await user.type(projectField, PROJECT);
    await user.click(screen.getByRole('button', { name: 'Issue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'an uploader token is pinned to one project',
    );
    expect(api.createToken).toHaveBeenCalledWith({
      name: 'ci',
      role: 'uploader',
      projectId: PROJECT,
    });
    unmount();
    render(
      <AccessPage
        health={client({ listTokens: vi.fn(async () => Promise.reject(new Error('forbidden'))) })}
      />,
    );
    expect(await screen.findByText('forbidden')).toBeInTheDocument();
  });

  it('signs out and reloads', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    try {
      const api = client();
      render(<AccessPage health={api} />);
      await user.click(await screen.findByRole('button', { name: 'Sign out' }));
      await waitFor(() => expect(reload).toHaveBeenCalled());
      expect(api.signOut).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('health view helpers, every band', () => {
  it.each([
    ['A+', 'text-success', 'success'],
    ['A', 'text-success', 'success'],
    ['B', 'text-fg', 'neutral'],
    ['C', 'text-warning', 'warning'],
    ['D', 'text-warning', 'warning'],
    ['F', 'text-danger', 'danger'],
    [null, 'text-fg-muted', 'neutral'],
  ] as const)('%s reads as %s', (letter, tone, meter) => {
    expect(letterTone(letter)).toBe(tone);
    expect(meterVariant(letter)).toBe(meter);
  });

  it('counts singular units, months, and a dimension with no summary as measured', () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    expect(ago('2026-10-23T11:59:59.000Z', now)).toBe('1 second ago');
    expect(ago('2026-08-23T12:00:00.000Z', now)).toBe('2 months ago');
    expect(ago('2025-10-01T12:00:00.000Z', now)).toBe('1 year ago');
    const quiet = grade({
      dimensions: HEALTH_DIMENSIONS.map((name) =>
        dimension({ dimension: name, measured: true, score: 99, letter: 'A+', summary: [] }),
      ),
      gates: [],
    });
    expect(whatIsGood(quiet)[0]).toBe('Security A+ — measured');
  });

  it('sorts equal letters by score, then by name, and ranks an unknown letter with the ungraded', () => {
    expect(
      worstFirst(entry({ letter: 'B', score: 81 }), entry({ letter: 'B', score: 85 })),
    ).toBeLessThan(0);
    expect(
      worstFirst(
        entry({ letter: 'B', score: null, name: 'b' }),
        entry({ letter: 'B', score: null, name: 'a' }),
      ),
    ).toBeGreaterThan(0);
    expect(worstFirst(entry({ letter: null }), entry({ letter: 'F' }))).toBeLessThan(0);
    expect(needsAttention(entry({ letter: null }))).toBe(true);
    expect(needsAttention(entry({ letter: 'F' }))).toBe(true);
    expect(needsAttention(entry({ letter: 'D' }))).toBe(true);
  });

  it('counts one repository in the singular, and none needing attention as good news', async () => {
    render(
      <Portfolio
        health={client({
          getPortfolio: vi.fn(async () => ({ projects: [entry({ letter: 'A', trend: -1.5 })] })),
        })}
      />,
    );
    await screen.findByTestId('portfolio');
    expect(screen.getByText('1 repository · 1 graded')).toBeInTheDocument();
    expect(screen.getByTestId('portfolio-attention')).toHaveTextContent('0');
    expect(screen.getByTestId('portfolio-improving')).toHaveTextContent('0');
  });
});
