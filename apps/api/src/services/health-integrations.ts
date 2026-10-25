import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { ConnectorAdapter } from '@automate/connectors-sdk';
import type { GateVerdict } from '@automate/projects';
import {
  HEALTH_DIMENSION_LABELS,
  type CanonicalFinding,
  type HealthGrade,
  type HealthLetter,
} from '@automate/shared-contracts';
import { z } from 'zod/v4';

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
