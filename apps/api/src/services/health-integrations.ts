import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { ConnectorAdapter } from '@automate/connectors-sdk';
import type { GateVerdict } from '@automate/projects';
import {
  HEALTH_DIMENSION_LABELS,
  type CanonicalFinding,
  type DiffCoverageRecord,
  type HealthGrade,
  type HealthLetter,
  type Scorecard,
} from '@automate/shared-contracts';
import { z } from 'zod/v4';
import type { AiGovernanceCheck } from './repo-health-service.js';
import type { EvalGateReading, EvalGateSuite } from './eval-service.js';
import type { CommitTests } from './commit-tests.js';

/**
 * What the health grade tells the outside world: a pull request's status and comment, and an
 * alert when the default branch gets worse.
 *
 * Every function here takes its transport — the GitHub and Slack adapters, `fetch` — as an
 * argument, so the decisions (what to say, when to say it) are tested without a network.
 */

// ─── GitHub pull requests ─────────────────────────────────────────────────────

/** `owner/repo` from a github.com URL in any of the three spellings, or `null`. */
export function githubRepository(url: string | null): { owner: string; repo: string } | null {
  if (url === null) return null;
  const match =
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u.exec(
      url,
    );
  return match === null ? null : { owner: match[1] as string, repo: match[2] as string };
}

/** The comment's first line, which is how the next report finds the comment to update. */
export const COMMENT_MARKER = '<!-- automate-health -->';
export const STATUS_CONTEXT = 'automate/health';
const COMMENT_FINDINGS = 10;

export interface GateReport {
  verdict: GateVerdict;
  grade: HealthGrade;
  added: readonly CanonicalFinding[];
  branch: string;
  detailsUrl: string | null;
  /** The commit's diff coverage; a line in the comment when present. */
  diffCoverage?: DiffCoverageRecord | null;
  /** The project's DORA scorecard; one line in the comment whenever it is measured. */
  delivery?: Scorecard | null;
  /** The AI-governance rules on the pull request; a section in the comment when present. */
  aiGovernance?: AiGovernanceCheck | null;
  /** Each eval suite against the default branch; an "Evals" section when any was compared. */
  evals?: EvalGateReading | null;
  /** The commit's test run and the quarantine verdict on it; a "Tests" section when present. */
  tests?: CommitTests | null;
}

const COMMENT_TESTS = 10;

/** Up to ten test identities, made safe for one line, and how many more there were. */
function testList(ids: readonly string[]): string {
  const shown = ids.slice(0, COMMENT_TESTS).map((id) => `\`${inline(id)}\``);
  const more = ids.length > COMMENT_TESTS ? ` …and ${String(ids.length - COMMENT_TESTS)} more` : '';
  return `${shown.join(', ')}${more}`;
}

/**
 * The "Tests" section: the commit's run, which failures are quarantined and which are not,
 * and the flaky tests nobody has quarantined yet. The same verdict `automate test` acted on,
 * because both read `excusesRun`.
 */
export function testsSection(tests: CommitTests): string[] {
  const lines = [
    '**Tests**',
    '',
    `${String(tests.total)} tests: ${String(tests.passed)} passed, ${String(tests.failed)} failed, ${String(tests.flaky)} flaky.`,
  ];
  if (tests.reportErrors > 0) {
    lines.push(
      `- ${String(tests.reportErrors)} error(s) outside the tests: nothing in this run is excused`,
    );
  }
  if (tests.failures.length > 0) lines.push(`- Failed: ${testList(tests.failures)}`);
  if (tests.quarantinedFailures.length > 0) {
    lines.push(
      `- Failed, quarantined${tests.excused ? ' (excused)' : ''}: ${testList(tests.quarantinedFailures)}`,
    );
  }
  if (tests.flakyUnquarantined.length > 0) {
    lines.push(`- Flaky, not quarantined: ${testList(tests.flakyUnquarantined)}`);
  }
  if (tests.unlabelledFailures > 0) {
    lines.push(`- ${String(tests.unlabelledFailures)} failure(s) whose cause has no triage label`);
  }
  return lines;
}

const EVAL_VERDICTS: Readonly<Record<EvalGateSuite['verdict'], string>> = {
  pass: 'passed',
  fail: 'failed',
  insufficient: 'not enough attempts to tell',
  'no-baseline': 'no baseline on the default branch',
  missing: 'runs on the default branch, not run on this branch',
};
const COMMENT_EVAL_CASES = 5;

/** Up to five case ids, made safe for one line, and how many more there were. */
function caseList(ids: readonly string[]): string {
  const shown = ids.slice(0, COMMENT_EVAL_CASES).map((id) => `\`${inline(id)}\``);
  const more =
    ids.length > COMMENT_EVAL_CASES ? ` …and ${String(ids.length - COMMENT_EVAL_CASES)} more` : '';
  return `${shown.join(', ')}${more}`;
}

/**
 * The "Evals" section: each suite's verdict against the default branch, the cases that
 * regressed beyond noise, and the flaky ones — listed, never a failure on their own. Whether
 * a failed suite failed the gate is the gate's reasons above, which name it only under
 * `gateOnEvals`.
 */
export function evalsSection(evals: EvalGateReading): string[] {
  const lines = ['**Evals**', ''];
  if (!evals.gateOnEvals) {
    lines.push('_Reported only: the policy does not gate on evals (`agents.gateOnEvals`)._', '');
  }
  for (const suite of evals.suites) {
    lines.push(`- \`${inline(suite.suite)}\`: ${EVAL_VERDICTS[suite.verdict]}`);
    if (suite.fellBack) {
      const ran =
        suite.commitSha === null ? 'no commit' : `\`${inline(suite.commitSha.slice(0, 12))}\``;
      lines.push(
        `  - No run on \`${inline(String(evals.commit).slice(0, 12))}\`; fell back to the branch's latest run (${ran})`,
      );
    }
    if (suite.regressions.length > 0) {
      lines.push(`  - Significant regressions: ${caseList(suite.regressions)}`);
    }
    if (suite.flaky.length > 0) lines.push(`  - Flaky: ${caseList(suite.flaky)}`);
  }
  return lines;
}

const ATTRIBUTION_LABELS: Readonly<Record<AiGovernanceCheck['attribution'], string>> = {
  'agent-authored': 'agent-authored',
  'ai-assisted': 'AI-assisted',
  human: 'human',
  unknown: 'unknown',
};

const GOVERNANCE_VERDICTS: Readonly<Record<AiGovernanceCheck['verdict']['verdict'], string>> = {
  pass: 'passed',
  fail: 'failed',
  'not-applicable': 'not applicable — the rules govern AI-written change only',
};

const COMMENT_SIGNALS = 5;

/** Text from a label or a bot login, made safe for one Markdown line. */
const inline = (text: string) => text.replace(/[`|<>\n\r]/gu, ' ');

/**
 * The "AI governance" section: the attribution with its confidence and signals, the verdict
 * and every reason, and — when attribution was unknown — why, so an unread pull request is
 * never silently passed as human.
 */
export function aiGovernanceSection(check: AiGovernanceCheck): string[] {
  const who = `${ATTRIBUTION_LABELS[check.attribution]}${check.agent === null ? '' : ` (${inline(check.agent)})`}`;
  const confidence = `${(check.confidence * 100).toFixed(0)}% confidence`;
  const signals = check.signals.slice(0, COMMENT_SIGNALS).map((signal) => inline(signal.detail));
  const more =
    check.signals.length > COMMENT_SIGNALS
      ? `; …and ${String(check.signals.length - COMMENT_SIGNALS)} more`
      : '';
  const lines = [
    '**AI governance**',
    '',
    `Attribution: ${who}, ${confidence}${signals.length === 0 ? '.' : ` — ${signals.join('; ')}${more}.`}`,
  ];
  if (check.unknownReason !== null) lines.push('', `_${check.unknownReason}_`);
  lines.push('', `Rules: ${GOVERNANCE_VERDICTS[check.verdict.verdict]}.`);
  lines.push(...check.verdict.reasons.map((reason) => `- ${reason}`));
  if (check.verdict.attributionNote !== null) lines.push('', `_${check.verdict.attributionNote}_`);
  return lines;
}

/** The four DORA metrics with a published tier, as the comment names them. */
const DORA_LINE_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['deployment-frequency', 'deployment frequency'],
  ['change-lead-time', 'lead time'],
  ['change-failure-rate', 'change failure rate'],
  ['failed-deployment-recovery-time', 'recovery time'],
];

/**
 * One line on the project's delivery: the DORA score, each banded metric's 2024 tier, and
 * what limited it. Only for a measured scorecard — one with a score; a card resting on too
 * little data has no line rather than a line of dashes.
 */
export function doraLine(card: Scorecard): string {
  const tiers = DORA_LINE_METRICS.map(([key, name]) => {
    const metric = card.metrics.find((entry) => entry.key === key);
    return `${name} ${metric?.band ?? 'not enough data'}`;
  }).join(' · ');
  const verdict = card.status === 'fail' ? ', failing' : '';
  return `**Delivery (DORA 2024):** ${String(card.score)} / 100${verdict} — ${tiers}. Limited by ${String(card.cappedBy)}.`;
}

const COMMENT_RANGES = 10;

/** Consecutive line numbers as `a-b` ranges: `[3, 4, 5, 9]` is `3-5` and `9`. */
export function lineRanges(lines: readonly number[]): string[] {
  const sorted = [...new Set(lines)].sort((left, right) => left - right);
  const ranges: string[] = [];
  let start: number | undefined;
  let end = 0;
  for (const line of sorted) {
    if (start !== undefined && line === end + 1) {
      end = line;
      continue;
    }
    if (start !== undefined)
      ranges.push(start === end ? String(start) : `${String(start)}-${String(end)}`);
    start = line;
    end = line;
  }
  if (start !== undefined)
    ranges.push(start === end ? String(start) : `${String(start)}-${String(end)}`);
  return ranges;
}

/** One line on the change's diff coverage, naming up to ten uncovered `file:line` ranges. */
export function diffCoverageLine(diff: DiffCoverageRecord): string {
  if (diff.ratio === null) {
    return '**Diff coverage:** no changed line is executable, so there is nothing to measure.';
  }
  const head = `**Diff coverage:** ${(diff.ratio * 100).toFixed(1)}% — ${String(diff.covered)} of ${plural(
    diff.executable,
    'changed executable line',
  )} ran.`;
  const ranges = diff.uncovered.flatMap((file) =>
    // A path comes from a report, so it may not close the code span.
    lineRanges(file.lines).map((range) => `\`${file.path.replace(/[`\n]/gu, ' ')}:${range}\``),
  );
  if (ranges.length === 0) return head;
  const more =
    ranges.length > COMMENT_RANGES ? `, …and ${String(ranges.length - COMMENT_RANGES)} more` : '';
  return `${head} Uncovered: ${ranges.slice(0, COMMENT_RANGES).join(', ')}${more}.`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** The new findings as a table, at most ten rows. */
function findingsTable(report: GateReport): string[] {
  if (report.added.length === 0) return ['No new findings against the default branch.'];
  const lines = [
    `**${plural(report.added.length, 'new finding')} on \`${report.branch}\`**`,
    '',
    '| Severity | Rule | Location |',
    '| --- | --- | --- |',
  ];
  for (const finding of report.added.slice(0, COMMENT_FINDINGS)) {
    const at = finding.line === null ? '' : `:${String(finding.line)}`;
    const location = finding.path === null ? '—' : `\`${finding.path}${at}\``;
    // A rule id and a path come from a scanner's report, so neither may close the table.
    const rule = finding.ruleId.replace(/[|`\n]/gu, ' ');
    lines.push(
      `| ${finding.severity} | ${finding.tool}: ${rule} | ${location.replace(/\|/gu, ' ')} |`,
    );
  }
  if (report.added.length > COMMENT_FINDINGS) {
    lines.push('', `…and ${String(report.added.length - COMMENT_FINDINGS)} more.`);
  }
  return lines;
}

function headlineOf(grade: HealthGrade): string {
  return grade.letter === null
    ? 'Incomplete'
    : `${grade.letter} · ${String(grade.score ?? 0)} / 100`;
}

export function renderGateComment(report: GateReport): string {
  const { grade, verdict } = report;
  const passed = verdict.verdict === 'passed';
  const lines = [
    COMMENT_MARKER,
    `### Repository health: ${headlineOf(grade)} — ${passed ? 'gate passed' : 'gate failed'}`,
    '',
    grade.limiter ?? grade.incompleteReason ?? '',
    '',
  ];
  if (verdict.reasons.length > 0) {
    lines.push(
      '**Why the gate failed**',
      '',
      ...verdict.reasons.map((reason) => `- ${reason}`),
      '',
    );
  }
  lines.push(...findingsTable(report));
  if (report.diffCoverage !== null && report.diffCoverage !== undefined) {
    lines.push('', diffCoverageLine(report.diffCoverage));
  }
  if (report.delivery !== null && report.delivery !== undefined && report.delivery.score !== null) {
    lines.push('', doraLine(report.delivery));
  }
  if (report.aiGovernance !== null && report.aiGovernance !== undefined) {
    lines.push('', ...aiGovernanceSection(report.aiGovernance));
  }
  if (report.evals !== null && report.evals !== undefined && report.evals.suites.length > 0) {
    lines.push('', ...evalsSection(report.evals));
  }
  if (report.tests !== null && report.tests !== undefined) {
    lines.push('', ...testsSection(report.tests));
  }
  const dimensions = grade.dimensions
    .filter((entry) => entry.measured)
    .map((entry) => `${HEALTH_DIMENSION_LABELS[entry.dimension]} ${entry.letter ?? '—'}`)
    .join(' · ');
  if (dimensions.length > 0) lines.push('', dimensions);
  if (report.detailsUrl !== null) lines.push('', `[Open the dashboard](${report.detailsUrl})`);
  return lines.join('\n');
}

export interface PullRequestTarget {
  owner: string;
  repo: string;
  sha: string;
  pullRequest?: number | undefined;
}

export type GitHubReport = {
  status: boolean;
  comment: 'created' | 'updated' | 'skipped' | 'failed';
  error?: string;
};

function statusDescription(report: GateReport): string {
  const fallback =
    report.grade.letter === null ? 'Grade incomplete' : `Graded ${report.grade.letter}`;
  return (report.verdict.reasons[0] ?? fallback).slice(0, 140);
}

const CommentListSchema = z.array(
  z.object({ id: z.number(), body: z.string().nullable().optional() }),
);

/** Updates the comment that starts with the marker, or creates one. */
async function upsertComment(
  github: ConnectorAdapter,
  token: string,
  base: { owner: string; repo: string },
  number: string,
  body: string,
): Promise<{ comment: GitHubReport['comment']; error?: string }> {
  const listed = await github.execute(
    { operation: 'listIssueComments', input: { ...base, number } },
    token,
  );
  if (listed.status !== 'ok')
    return { comment: 'failed', error: listed.error?.code ?? 'list_failed' };
  const comments = CommentListSchema.safeParse(listed.data);
  const existing = comments.success
    ? comments.data.find((comment) => comment.body?.startsWith(COMMENT_MARKER) === true)
    : undefined;
  const written =
    existing === undefined
      ? await github.execute(
          { operation: 'createIssueComment', input: { ...base, number, body } },
          token,
        )
      : await github.execute(
          {
            operation: 'updateIssueComment',
            input: { ...base, commentId: String(existing.id), body },
          },
          token,
        );
  if (written.status !== 'ok')
    return {
      comment: 'failed',
      ...(written.error === undefined ? {} : { error: written.error.code }),
    };
  return { comment: existing === undefined ? 'created' : 'updated' };
}

/**
 * Posts the commit status, and creates or updates the one gate comment.
 *
 * Returns what it did, never throws for a GitHub refusal: a gate whose verdict was computed
 * should be returned to the CI job even when GitHub said no to the comment.
 */
export async function reportToGitHub(
  github: ConnectorAdapter,
  token: string,
  target: PullRequestTarget,
  report: GateReport,
): Promise<GitHubReport> {
  const base = { owner: target.owner, repo: target.repo };
  const status = await github.execute(
    {
      operation: 'createCommitStatus',
      input: {
        ...base,
        sha: target.sha,
        state: report.verdict.verdict === 'passed' ? 'success' : 'failure',
        context: STATUS_CONTEXT,
        description: statusDescription(report),
        ...(report.detailsUrl === null ? {} : { target_url: report.detailsUrl }),
      },
    },
    token,
  );
  const posted = status.status === 'ok';
  if (target.pullRequest === undefined) {
    return {
      status: posted,
      comment: 'skipped',
      ...(status.error === undefined ? {} : { error: status.error.code }),
    };
  }
  const comment = await upsertComment(
    github,
    token,
    base,
    String(target.pullRequest),
    renderGateComment(report),
  );
  return { status: posted, ...comment };
}
// ─── Alerts ───────────────────────────────────────────────────────────────────

export const AlertSettingsSchema = z.object({
  webhookUrl: z.string().url().max(2000).nullable().optional(),
  slackChannel: z
    .string()
    .regex(/^[#A-Za-z0-9._-]{1,80}$/u)
    .nullable()
    .optional(),
});
export type AlertSettings = z.infer<typeof AlertSettingsSchema>;

/**
 * A webhook target this install may call: `https`, and not a loopback, private or
 * link-local address written as a literal.
 *
 * The server makes the request, so a URL is a request the server makes on the caller's
 * behalf. A hostname that *resolves* to a private address is not caught here — an operator
 * who can configure alerts is trusted not to point them at the metadata service, and the
 * install's egress policy is where that is enforced.
 */
export function isAllowedWebhook(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '')
    return false;
  const host = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    return false;
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number) as [number, number];
    return !(
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(host) === 6)
    return !(
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80')
    );
  return true;
}

export type HealthAlert =
  | {
      kind: 'grade-dropped';
      from: HealthLetter | null;
      to: HealthLetter | null;
      limiter: string | null;
    }
  | {
      kind: 'new-critical';
      findings: Array<Pick<CanonicalFinding, 'tool' | 'ruleId' | 'path' | 'line'>>;
    };

const ORDER: readonly (HealthLetter | null)[] = [null, 'F', 'D', 'C', 'B', 'A', 'A+'];

/**
 * The alerts one report produced, on the default branch only.
 *
 * Deduplicated by construction: a drop fires on the transition, so a grade that stays at D
 * does not alert twice, and a finding is new exactly once.
 */
export function alertsFor(input: {
  previous: { letter: HealthLetter | null } | null;
  current: HealthGrade;
  added: readonly CanonicalFinding[];
  onDefaultBranch: boolean;
}): HealthAlert[] {
  if (!input.onDefaultBranch) return [];
  const alerts: HealthAlert[] = [];
  const before = input.previous?.letter ?? null;
  const after = input.current.letter;
  if (input.previous !== null && before !== null && ORDER.indexOf(after) < ORDER.indexOf(before)) {
    alerts.push({
      kind: 'grade-dropped',
      from: before,
      to: after,
      limiter: input.current.limiter ?? input.current.incompleteReason,
    });
  }
  const critical = input.added.filter((finding) => finding.severity === 'critical');
  if (critical.length > 0) {
    alerts.push({
      kind: 'new-critical',
      findings: critical.slice(0, 20).map((finding) => ({
        tool: finding.tool,
        ruleId: finding.ruleId,
        path: finding.path,
        line: finding.line,
      })),
    });
  }
  return alerts;
}

export function alertText(project: string, alert: HealthAlert, detailsUrl: string | null): string {
  const link = detailsUrl === null ? '' : ` ${detailsUrl}`;
  if (alert.kind === 'grade-dropped') {
    return `${project}: health fell from ${alert.from ?? '—'} to ${alert.to ?? 'incomplete'}. ${alert.limiter ?? ''}${link}`.trim();
  }
  const first = alert.findings[0];
  const where =
    first === undefined
      ? ''
      : ` — ${first.tool}: ${first.ruleId}${first.path === null ? '' : ` in ${first.path}`}`;
  return `${project}: ${String(alert.findings.length)} new critical finding${alert.findings.length === 1 ? '' : 's'}${where}.${link}`;
}

export interface AlertTransport {
  slack?: { adapter: ConnectorAdapter; token: string } | undefined;
  /** Signs webhook bodies. Absent: webhooks are not sent, because an unsigned one is spoofable. */
  webhookSecret?: string | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** The signature header value: `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export function signWebhook(secret: string, body: string, unixSeconds: number): string {
  const mac = createHmac('sha256', secret)
    .update(`${String(unixSeconds)}.${body}`)
    .digest('hex');
  return `t=${String(unixSeconds)},v1=${mac}`;
}

interface AlertEvent {
  projectId: string;
  project: string;
  branch: string;
  detailsUrl: string | null;
  alerts: readonly HealthAlert[];
}

async function sendSlack(
  slack: NonNullable<AlertTransport['slack']>,
  channel: string,
  event: AlertEvent,
): Promise<string[]> {
  const outcomes: string[] = [];
  for (const alert of event.alerts) {
    const result = await slack.adapter.execute(
      {
        operation: 'postMessage',
        input: { channel, text: alertText(event.project, alert, event.detailsUrl) },
      },
      slack.token,
    );
    outcomes.push(
      `slack ${alert.kind}: ${result.status === 'ok' ? 'sent' : (result.error?.code ?? 'failed')}`,
    );
  }
  return outcomes;
}

async function sendWebhook(
  transport: AlertTransport,
  secret: string,
  url: string,
  event: AlertEvent,
): Promise<string> {
  const body = JSON.stringify({
    type: 'automate.health.alert',
    projectId: event.projectId,
    project: event.project,
    branch: event.branch,
    detailsUrl: event.detailsUrl,
    alerts: event.alerts,
  });
  const unix = Math.floor((transport.now?.() ?? new Date()).getTime() / 1000);
  try {
    const response = await (transport.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-automate-signature': signWebhook(secret, body, unix),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    return `webhook: ${String(response.status)}`;
  } catch (error) {
    return `webhook: ${error instanceof Error ? error.message : 'failed'}`;
  }
}

/** Sends every alert to every configured target. Returns one line per delivery, for the log. */
export async function deliverAlerts(
  transport: AlertTransport,
  settings: AlertSettings,
  event: AlertEvent,
): Promise<string[]> {
  if (event.alerts.length === 0) return [];
  const outcomes: string[] = [];
  if (settings.slackChannel != null && transport.slack !== undefined) {
    outcomes.push(...(await sendSlack(transport.slack, settings.slackChannel, event)));
  }
  const { webhookUrl } = settings;
  if (webhookUrl != null && transport.webhookSecret !== undefined && isAllowedWebhook(webhookUrl)) {
    outcomes.push(await sendWebhook(transport, transport.webhookSecret, webhookUrl, event));
  }
  return outcomes;
}
