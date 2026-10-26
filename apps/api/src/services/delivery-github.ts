import { z } from 'zod/v4';
import { AGENT_SIGNATURES } from '@automate/reporting';

/**
 * What the delivery sync reads out of GitHub's answers, and what it derives from them.
 *
 * Pure, so every rule is tested against a fixture rather than a network. Each schema reads
 * only the fields it uses and lets the rest pass: GitHub adds fields, and an answer with one
 * more field is not a malformed answer. An item that lacks a field this needs is skipped and
 * counted, never guessed at.
 */

const Login = z.object({ login: z.string() }).nullable().optional();
const Instant = z.string().refine((value) => Number.isFinite(Date.parse(value)));

export const GitHubPullSchema = z.object({
  id: z.number(),
  number: z.number().int(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().optional(),
  user: Login,
  head: z.object({ ref: z.string(), sha: z.string().optional() }).optional(),
  base: z.object({ ref: z.string() }).optional(),
  labels: z.array(z.object({ name: z.string() })).optional(),
  title: z.string(),
  body: z.string().nullable().optional(),
  created_at: Instant,
  updated_at: Instant,
  closed_at: Instant.nullable().optional(),
  merged_at: Instant.nullable().optional(),
  merge_commit_sha: z.string().nullable().optional(),
});
export type GitHubPull = z.infer<typeof GitHubPullSchema>;

export const GitHubReviewSchema = z.object({
  user: Login,
  state: z.string(),
  submitted_at: Instant.nullable().optional(),
});
export type GitHubReview = z.infer<typeof GitHubReviewSchema>;

const Person = z
  .object({
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    date: Instant.optional(),
  })
  .nullable()
  .optional();

export const GitHubCommitSchema = z.object({
  sha: z.string(),
  commit: z.object({ author: Person, committer: Person, message: z.string() }),
  author: Login,
  committer: Login,
});
export type GitHubCommit = z.infer<typeof GitHubCommitSchema>;

export const GitHubFileSchema = z.object({
  filename: z.string(),
  additions: z.number().int().min(0).optional(),
  deletions: z.number().int().min(0).optional(),
});
export type GitHubFile = z.infer<typeof GitHubFileSchema>;

export const GitHubDeploymentSchema = z.object({
  id: z.number(),
  sha: z.string().nullable().optional(),
  environment: z.string(),
  created_at: Instant,
});
export type GitHubDeployment = z.infer<typeof GitHubDeploymentSchema>;

export const GitHubDeploymentStatusSchema = z.object({
  state: z.string(),
  environment_url: z.string().nullable().optional(),
  log_url: z.string().nullable().optional(),
});

export const GitHubWorkflowRunSchema = z.object({
  id: z.number(),
  name: z.string().nullable().optional(),
  path: z.string().optional(),
  head_sha: z.string(),
  head_branch: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  created_at: Instant,
  updated_at: Instant,
  html_url: z.string().optional(),
});
export type GitHubWorkflowRun = z.infer<typeof GitHubWorkflowRunSchema>;

/** The items of a list that parse, and how many did not. */
export function parseItems<T>(
  schema: z.ZodType<T>,
  items: readonly unknown[],
): { parsed: T[]; skipped: number } {
  const parsed: T[] = [];
  let skipped = 0;
  for (const item of items) {
    const result = schema.safeParse(item);
    if (result.success) parsed.push(result.data);
    else skipped += 1;
  }
  return { parsed, skipped };
}

/** The body is kept for attribution markers, not as a mirror: 4000 characters at most. */
export const PR_BODY_LIMIT = 4000;
export const COMMIT_MESSAGE_LIMIT = 2000;

/**
 * Whether a changed path is a test. The conventions of the ecosystems this install detects:
 * a `test`/`tests`/`__tests__`/`spec`/`e2e` directory, `*.test.*` and `*.spec.*`, Go's
 * `_test.go`, and Python's `test_*.py` / `*_test.py`.
 */
export function isTestPath(path: string): boolean {
  const normalised = path.replace(/\\/gu, '/').toLowerCase();
  return (
    /(?:^|\/)(?:__tests__|tests?|spec|e2e)\//u.test(normalised) ||
    /\.(?:test|spec)\.[a-z0-9]+$/u.test(normalised) ||
    /_test\.(?:go|py)$/u.test(normalised) ||
    /(?:^|\/)test_[^/]+\.py$/u.test(normalised)
  );
}

const earliest = (values: readonly (string | null | undefined)[]): Date | null => {
  const times = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => Date.parse(value));
  return times.length === 0 ? null : new Date(Math.min(...times));
};

/**
 * Whether a reviewer is a human other than the author. GitHub Apps log in as `<slug>[bot]`;
 * an AI agent whose login has no suffix (`copilot`, `openhands-agent`) is recognised from the
 * attribution signature table. Logins compare case-insensitively, as GitHub's do.
 */
export function isHumanReviewer(login: string | undefined, author: string | null): boolean {
  if (login === undefined || login.trim() === '') return false;
  const lowered = login.toLowerCase();
  if (author !== null && lowered === author.toLowerCase()) return false;
  if (lowered.endsWith('[bot]')) return false;
  return !AGENT_BOT_LOGINS.has(lowered);
}

const AGENT_BOT_LOGINS: ReadonlySet<string> = new Set(
  AGENT_SIGNATURES.entries
    .filter((entry) => entry.kind === 'bot-login')
    .map((entry) => entry.pattern),
);

/**
 * The review facts of one pull request.
 *
 * A review is a submitted review by someone other than the author: a pending draft review is
 * not one, and an author answering their own thread is not reviewing. `commentCount` is the
 * reviews that only commented. Approvals count distinct approvers, so re-approving after a
 * push is still one approval. `humanApprovalCount` counts only the approvers
 * {@link isHumanReviewer} accepts — what the AI-governance gate's human-approval rule reads.
 */
export function reviewFacts(
  reviews: readonly GitHubReview[],
  author: string | null,
): {
  firstReviewAt: Date | null;
  approvedAt: Date | null;
  reviewCount: number;
  approvalCount: number;
  humanApprovalCount: number;
  commentCount: number;
} {
  const submitted = reviews.filter(
    (review) =>
      review.state.toUpperCase() !== 'PENDING' &&
      (author === null || review.user?.login !== author),
  );
  const approvals = submitted.filter((review) => review.state.toUpperCase() === 'APPROVED');
  const humans = approvals
    .map((review) => review.user?.login)
    .filter((login): login is string => isHumanReviewer(login, author))
    .map((login) => login.toLowerCase());
  return {
    firstReviewAt: earliest(submitted.map((review) => review.submitted_at)),
    approvedAt: earliest(approvals.map((review) => review.submitted_at)),
    reviewCount: submitted.length,
    approvalCount: new Set(approvals.map((review) => review.user?.login ?? '')).size,
    humanApprovalCount: new Set(humans).size,
    commentCount: submitted.filter((review) => review.state.toUpperCase() === 'COMMENTED').length,
  };
}

/** Changed paths kept per pull request, and the length each is cut to. */
export const CHANGED_PATHS_LIMIT = 300;
const PATH_LIMIT = 500;

/** What a pull request's commits and files say: when work started, its size, tests, paths. */
export function changeFacts(
  commits: readonly GitHubCommit[],
  files: readonly GitHubFile[],
): {
  firstCommitAt: Date | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  testsTouched: boolean;
  changedPaths: string[];
} {
  return {
    firstCommitAt: earliest(
      commits.map((commit) => commit.commit.author?.date ?? commit.commit.committer?.date),
    ),
    additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    changedFiles: files.length,
    testsTouched: files.some((file) => isTestPath(file.filename)),
    changedPaths: files
      .slice(0, CHANGED_PATHS_LIMIT)
      .map((file) => file.filename.slice(0, PATH_LIMIT)),
  };
}

export function stateOf(pr: GitHubPull): 'open' | 'closed' | 'merged' {
  if (pr.merged_at !== null && pr.merged_at !== undefined) return 'merged';
  return pr.state;
}

/** A commit as the `commits` table holds it. */
export function commitValues(commit: GitHubCommit, prNumber: number | null) {
  const at = commit.commit.author?.date ?? commit.commit.committer?.date;
  return {
    sha: commit.sha.toLowerCase(),
    prNumber,
    authorLogin: commit.author?.login ?? null,
    authorEmail: commit.commit.author?.email ?? null,
    authorName: commit.commit.author?.name ?? null,
    committerLogin: commit.committer?.login ?? null,
    message: commit.commit.message.slice(0, COMMIT_MESSAGE_LIMIT),
    committedAt: at === undefined ? null : new Date(at),
  };
}

/**
 * A deployment's outcome from its latest status, or `null` while GitHub has not decided.
 *
 * `inactive` is a deployment a later one superseded, which GitHub only does to one that went
 * live, so it is a success. `queued`, `pending` and `in_progress` are not outcomes yet; the
 * sync reads them again on its next pass (deployments are re-read a day back).
 */
export function deploymentOutcome(state: string | undefined): 'success' | 'failure' | null {
  switch (state?.toLowerCase()) {
    case 'success':
    case 'inactive':
      return 'success';
    case 'failure':
    case 'error':
      return 'failure';
    default:
      return null;
  }
}

/**
 * A completed run of a deploy workflow as a deployment, or `null` when it is not one: another
 * workflow, a run that was cancelled or skipped (it deployed nothing), or one still running.
 * The deployment happened when the run finished, so its time is the run's `updated_at`.
 */
export function workflowRunDeployment(
  run: GitHubWorkflowRun,
  deployWorkflows: readonly string[],
  environment: string,
): {
  externalId: string;
  environment: string;
  status: 'success' | 'failure';
  createdAt: Date;
  sha: string;
  url: string | null;
} | null {
  const wanted = deployWorkflows.map((name) => name.toLowerCase());
  const named =
    (run.name !== null && run.name !== undefined && wanted.includes(run.name.toLowerCase())) ||
    (run.path !== undefined && wanted.some((name) => run.path?.toLowerCase().endsWith(name)));
  if (!named) return null;
  const conclusion = run.conclusion?.toLowerCase();
  const status =
    conclusion === 'success'
      ? 'success'
      : conclusion === 'failure' || conclusion === 'timed_out'
        ? 'failure'
        : null;
  if (status === null) return null;
  return {
    externalId: `run:${String(run.id)}`,
    environment,
    status,
    createdAt: new Date(run.updated_at),
    sha: run.head_sha.toLowerCase(),
    url: run.html_url ?? null,
  };
}
