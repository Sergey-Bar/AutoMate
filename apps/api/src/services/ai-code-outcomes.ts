import type { PullRequestRow } from '@automate/db';
import type { AiOutcomeChange, Attribution } from '@automate/reporting';
import type { AiShareWeek } from '@automate/shared-contracts';

/**
 * What happened to each merged pull request after it merged, as `compareAiOutcomes` reads it.
 * Pure: every rule here is a function of rows already read, so each is tested against a
 * fixture. `ai-code-service.ts` reads the rows.
 *
 * Only pull requests merged into the default branch are changes here — what landed, and the
 * only change a production deployment can carry. The definitions:
 *
 * - **reverted** — a later merged pull request is GitHub's revert of it (head branch
 *   `revert-<number>-…`, or title exactly `Revert "<title>"`), or a landed commit's message
 *   says `This reverts commit <merge sha>` (a prefix of at least seven characters counts). A
 *   landed commit is a default-branch commit or one of a merged pull request's commits.
 * - **causedFailure** — DORA's verdict on the first production deployment that carried the
 *   merge commit (`productionCarriersOf` in `delivery-service.ts`, one definition with the
 *   change-failure rate); `null` when no production deployment carried it.
 * - **followUpFixDays** — days from merge to the first later merged pull request that is a fix
 *   ({@link isFixPullRequest}) and touched one of the same files; `null` if none has, and
 *   `null` too for a pull request synced before its changed paths were kept.
 * - **review inputs** — lines changed is additions + deletions; review comments are the reviews
 *   that only commented; approved-without-comments is an approval with no such review.
 * - **diffCoverage** — the diff coverage measured for the head commit, 0–100.
 * - **newHighFindings** — the high plus critical findings the gate found new on the pull
 *   request, from its last gate report; `null` when the gate never reported on it.
 */

export type OutcomePullRequest = Pick<
  PullRequestRow,
  | 'id'
  | 'number'
  | 'title'
  | 'labels'
  | 'headBranch'
  | 'baseBranch'
  | 'mergedAt'
  | 'mergeCommitSha'
  | 'headSha'
  | 'changedPaths'
  | 'additions'
  | 'deletions'
  | 'commentCount'
  | 'approvalCount'
  | 'attribution'
  | 'aiAgent'
>;

export interface OutcomeInputs {
  pullRequests: readonly OutcomePullRequest[];
  /** Landed commits whose message may revert something; only `message` is read. */
  landedCommits: readonly { message: string }[];
  /** Merge sha → DORA's verdict on the first production deployment that carried it. */
  carriers: ReadonlyMap<string, { failed: boolean }>;
  /** Head sha → diff coverage, 0–100. */
  diffCoverage: ReadonlyMap<string, number>;
  /** Pull request number → what the gate found new on it. */
  gateFindings: ReadonlyMap<number, { high: number; critical: number }>;
  defaultBranch: string;
}

const DAY_MS = 86_400_000;
const REVERT_BRANCH = /^revert-(\d+)-/u;
const REVERTS_COMMIT = /this reverts commit ([0-9a-f]{7,40})/giu;
const FIX_TITLE = /(?:^|[^a-z0-9])(?:bug|hot)?fix(?:es|ed)?(?=[^a-z0-9]|$)/iu;
const FIX_LABEL_PREFIX = /^(?:type|kind)\s*[:/]\s*/iu;
const FIX_LABEL = /^(?:bug|bugfix|hotfix|fix)$/iu;
const FIX_BRANCH = /^(?:bug|hot)?fix(?:es)?[/-]/iu;
const ATTRIBUTIONS: ReadonlySet<string> = new Set([
  'agent-authored',
  'ai-assisted',
  'human',
  'unknown',
]);

const mergedTime = (pr: Pick<OutcomePullRequest, 'mergedAt'>) => pr.mergedAt?.getTime() ?? null;

/** Whether `candidate` is a later merged GitHub revert of `original`. */
export function isRevertOf(
  candidate: Pick<OutcomePullRequest, 'number' | 'title' | 'headBranch' | 'mergedAt'>,
  original: Pick<OutcomePullRequest, 'number' | 'title' | 'mergedAt'>,
): boolean {
  const at = mergedTime(candidate);
  const since = mergedTime(original);
  if (at === null || since === null || at <= since || candidate.number === original.number) {
    return false;
  }
  const branch = REVERT_BRANCH.exec(candidate.headBranch ?? '');
  if (branch !== null && Number(branch[1]) === original.number) return true;
  return candidate.title === `Revert "${original.title}"`;
}

/** Every commit sha a message says it reverts, lower-cased. */
export function revertedShas(landed: readonly { message: string }[]): Set<string> {
  const shas = new Set<string>();
  for (const { message } of landed) {
    for (const match of message.matchAll(REVERTS_COMMIT))
      shas.add((match[1] as string).toLowerCase());
  }
  return shas;
}

/**
 * A fix: a title naming `fix`, `fixes`, `fixed`, `bugfix` or `hotfix` as a word (a
 * conventional `fix:` / `fix(scope):` included), a label `fix`, `bug`, `bugfix` or `hotfix`
 * (optionally `type:` / `kind/`), or a head branch starting `fix/`, `bugfix/` or `hotfix/` (or
 * with `-`). Case-insensitive.
 */
export function isFixPullRequest(
  pr: Pick<OutcomePullRequest, 'title' | 'labels' | 'headBranch'>,
): boolean {
  return (
    FIX_TITLE.test(pr.title) ||
    pr.labels.some((label) => FIX_LABEL.test(label.trim().replace(FIX_LABEL_PREFIX, ''))) ||
    FIX_BRANCH.test(pr.headBranch ?? '')
  );
}

function revertedBySha(pr: OutcomePullRequest, reverted: ReadonlySet<string>): boolean {
  const sha = pr.mergeCommitSha;
  if (sha === null) return false;
  if (reverted.has(sha)) return true;
  for (const prefix of reverted) if (sha.startsWith(prefix)) return true;
  return false;
}

function followUpFixDays(
  pr: OutcomePullRequest,
  fixes: readonly OutcomePullRequest[],
): number | null {
  const since = mergedTime(pr);
  if (since === null || pr.changedPaths.length === 0) return null;
  const paths = new Set(pr.changedPaths);
  const fix = fixes.find(
    (candidate) =>
      (mergedTime(candidate) ?? 0) > since &&
      candidate.number !== pr.number &&
      !isRevertOf(candidate, pr) &&
      candidate.changedPaths.some((path) => paths.has(path)),
  );
  return fix === undefined ? null : ((mergedTime(fix) as number) - since) / DAY_MS;
}

const attributionOf = (value: string): Attribution =>
  (ATTRIBUTIONS.has(value) ? value : 'unknown') as Attribution;

function newFindings(entry: { high: number; critical: number } | undefined): number | null {
  return entry === undefined ? null : entry.high + entry.critical;
}

/** The numbers of the landed pull requests some later landed pull request reverts. */
function revertedNumbers(landed: readonly OutcomePullRequest[]): Set<number> {
  const byNumber = new Map(landed.map((pr) => [pr.number, pr]));
  const byTitle = new Map<string, OutcomePullRequest[]>();
  for (const pr of landed) byTitle.set(pr.title, [...(byTitle.get(pr.title) ?? []), pr]);
  const numbers = new Set<number>();
  for (const candidate of landed) {
    const branch = REVERT_BRANCH.exec(candidate.headBranch ?? '');
    const titled = /^Revert "(.*)"$/su.exec(candidate.title);
    const targets = [
      ...(branch === null ? [] : [byNumber.get(Number(branch[1]))]),
      ...(titled === null ? [] : (byTitle.get(titled[1] as string) ?? [])),
    ];
    for (const target of targets) {
      if (target !== undefined && isRevertOf(candidate, target)) numbers.add(target.number);
    }
  }
  return numbers;
}

/** Each merged pull request's outcomes, in the order given. */
export function deriveOutcomes(inputs: OutcomeInputs): AiOutcomeChange[] {
  const landed = inputs.pullRequests
    .filter((pr) => pr.mergedAt !== null && pr.baseBranch === inputs.defaultBranch)
    .sort((left, right) => (mergedTime(left) as number) - (mergedTime(right) as number));
  const fixes = landed.filter((pr) => isFixPullRequest(pr));
  const reverted = revertedShas(inputs.landedCommits);
  const revertedPrs = revertedNumbers(landed);
  const included = new Set(landed);
  const ordered = inputs.pullRequests.filter((pr) => included.has(pr));
  return ordered.map((pr) => {
    const sha = pr.mergeCommitSha;
    return {
      id: pr.id,
      attribution: attributionOf(pr.attribution),
      agent: pr.aiAgent,
      mergedAt: (pr.mergedAt as Date).toISOString(),
      reverted: revertedPrs.has(pr.number) || revertedBySha(pr, reverted),
      causedFailure: sha === null ? null : (inputs.carriers.get(sha)?.failed ?? null),
      followUpFixDays: followUpFixDays(pr, fixes),
      linesChanged: pr.additions + pr.deletions,
      reviewComments: pr.commentCount,
      approvedWithoutComments: pr.approvalCount > 0 && pr.commentCount === 0,
      diffCoverage: pr.headSha === null ? null : (inputs.diffCoverage.get(pr.headSha) ?? null),
      newHighFindings: newFindings(inputs.gateFindings.get(pr.number)),
    };
  });
}

const WEEK_MS = 7 * DAY_MS;

/** Monday 00:00 UTC of the week `at` falls in. */
function weekStart(at: number): number {
  const day = new Date(at);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return midnight - ((day.getUTCDay() + 6) % 7) * DAY_MS;
}

const SHARE_KEY: Readonly<Record<Attribution, Exclude<keyof AiShareWeek, 'weekStart' | 'total'>>> =
  {
    'agent-authored': 'agentAuthored',
    'ai-assisted': 'aiAssisted',
    human: 'human',
    unknown: 'unknown',
  };

/**
 * Merged changes per week by attribution, every week of `[now − windowDays, now]` present and
 * zero-filled so a chart never draws a gap as a trend. A change outside the window, or with an
 * unreadable merge time, is not counted.
 */
export function weeklyShare(
  changes: readonly { attribution: Attribution; mergedAt: string }[],
  now: Date,
  windowDays: number,
): AiShareWeek[] {
  const end = now.getTime();
  const start = end - windowDays * DAY_MS;
  const weeks = new Map<number, AiShareWeek>();
  for (let at = weekStart(start); at <= end; at += WEEK_MS) {
    weeks.set(at, {
      weekStart: new Date(at).toISOString().slice(0, 10),
      agentAuthored: 0,
      aiAssisted: 0,
      human: 0,
      unknown: 0,
      total: 0,
    });
  }
  for (const change of changes) {
    const at = Date.parse(change.mergedAt);
    if (!Number.isFinite(at) || at < start || at > end) continue;
    const week = weeks.get(weekStart(at)) as AiShareWeek;
    week[SHARE_KEY[change.attribution]] += 1;
    week.total += 1;
  }
  return [...weeks.values()];
}
