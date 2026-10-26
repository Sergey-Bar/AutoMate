import { createHash } from 'node:crypto';
import {
  AGENT_SIGNATURES,
  KIND_WEIGHTS,
  NOT_AI_BOT_DETAIL,
  classifyAttribution,
  confidenceOfKinds,
  type Attribution,
  type AttributionMode,
  type AttributionOptions,
  type AttributionResult,
  type AttributionSignal,
} from '@automate/reporting';

/**
 * A pull request's attribution, from the pull request itself and from its commits.
 *
 * `classifyAttribution` reads one subject. A pull request is several: the pull request (its
 * author, head branch, labels and body) and each of its commits (author, committer, the
 * trailers and markers in the message). **The roll-up rule:**
 *
 * 1. Each is classified on its own. The policy's labels apply to the pull request only —
 *    a commit has no labels.
 * 2. **Agent-authored wins.** If the pull request or any commit reads agent-authored, the
 *    pull request is agent-authored: an agent pushed code into it. Otherwise, if any reads
 *    ai-assisted, it is ai-assisted — so a commit carrying an agent co-author trailer makes the
 *    pull request at least ai-assisted.
 * 3. With no AI signal anywhere it is human when the pull request or any commit has a human
 *    author identity, and `unknown` when none does — never human by default.
 * 4. The agent is the pull request's own when it carries the winning mode, else the one most
 *    commits of that mode name (a tie goes to the earliest commit).
 * 5. Confidence is the classifier's noisy-OR over the *distinct kinds* of AI evidence across
 *    all of them, so thirty commits with the same trailer are one piece of evidence and a new
 *    kind can only raise it. A non-AI bot is reported as a signal and weighs nothing. Human
 *    is reported at the classifier's floor.
 *
 * Signals are kept (at most {@link MAX_SIGNALS}, one per kind and detail) with the commit's
 * short sha in front of a commit's. Every detail names a signature, a label or a bot, never a
 * person.
 */

export interface PullRequestSubject {
  authorLogin: string | null;
  headBranch: string | null;
  labels: readonly string[];
  body: string | null;
}

export interface CommitSubject {
  sha: string;
  authorLogin: string | null;
  authorEmail: string | null;
  authorName: string | null;
  committerLogin: string | null;
  message: string;
}

export interface PullRequestAttribution {
  attribution: Attribution;
  agent: string | null;
  confidence: number;
  signals: AttributionSignal[];
  version: string;
}

export const MAX_SIGNALS = 20;
const DETAIL_LIMIT = 300;

const normalisedLabels = (labels: readonly string[] | undefined) =>
  [...new Set((labels ?? []).map((label) => label.trim().toLowerCase()))].sort();

/**
 * The version a row is classified against: the signature table's, and a short digest of the
 * policy labels when there are any, so changing either is detectable on the stored row.
 */
export function attributionVersionOf(options: AttributionOptions): string {
  const agent = normalisedLabels(options.agentLabels);
  const assisted = normalisedLabels(options.assistedLabels);
  if (agent.length === 0 && assisted.length === 0) return AGENT_SIGNATURES.version;
  const digest = createHash('sha256')
    .update(JSON.stringify({ agent, assisted }))
    .digest('hex')
    .slice(0, 8);
  return `${AGENT_SIGNATURES.version}+labels:${digest}`;
}

interface Reading {
  result: AttributionResult;
  /** `null` for the pull request itself. */
  sha: string | null;
}

const isAi = (attribution: Attribution): attribution is AttributionMode =>
  attribution === 'agent-authored' || attribution === 'ai-assisted';

function winningMode(readings: readonly Reading[]): AttributionMode | null {
  if (readings.some((reading) => reading.result.attribution === 'agent-authored')) {
    return 'agent-authored';
  }
  return readings.some((reading) => reading.result.attribution === 'ai-assisted')
    ? 'ai-assisted'
    : null;
}

function agentFor(readings: readonly Reading[], mode: AttributionMode): string | null {
  const counts = new Map<string, number>();
  for (const { result } of readings) {
    if (result.attribution !== mode || result.agent === null) continue;
    counts.set(result.agent, (counts.get(result.agent) ?? 0) + 1);
  }
  const own = readings[0]?.result;
  if (own?.attribution === mode && own.agent !== null) return own.agent;
  let best: string | null = null;
  let bestCount = 0;
  for (const [agent, count] of counts) {
    if (count > bestCount) {
      best = agent;
      bestCount = count;
    }
  }
  return best;
}

function aiConfidence(readings: readonly Reading[]): number {
  return confidenceOfKinds(
    readings
      .filter((reading) => isAi(reading.result.attribution))
      .flatMap((reading) => reading.result.signals)
      .filter((signal) => !signal.detail.endsWith(NOT_AI_BOT_DETAIL))
      .map((signal) => signal.kind),
  );
}

function collectSignals(readings: readonly Reading[]): AttributionSignal[] {
  const seen = new Set<string>();
  const signals: AttributionSignal[] = [];
  for (const { result, sha } of readings) {
    for (const signal of result.signals) {
      const key = `${signal.kind}\u0000${signal.detail}`;
      if (seen.has(key) || signals.length >= MAX_SIGNALS) continue;
      seen.add(key);
      const detail = sha === null ? signal.detail : `commit ${sha.slice(0, 7)}: ${signal.detail}`;
      signals.push({ kind: signal.kind, detail: detail.slice(0, DETAIL_LIMIT) });
    }
  }
  return signals;
}

/** Classify one pull request by the roll-up rule above. Pure. */
export function classifyPullRequest(
  pr: PullRequestSubject,
  commits: readonly CommitSubject[],
  options: AttributionOptions,
): PullRequestAttribution {
  const readings: Reading[] = [
    {
      sha: null,
      result: classifyAttribution(
        { authorLogin: pr.authorLogin, branch: pr.headBranch, labels: pr.labels, notes: pr.body },
        options,
      ),
    },
    ...commits.map((commit) => ({
      sha: commit.sha,
      result: classifyAttribution({
        authorLogin: commit.authorLogin,
        authorEmail: commit.authorEmail,
        authorName: commit.authorName,
        committerLogin: commit.committerLogin,
        message: commit.message,
      }),
    })),
  ];
  const version = attributionVersionOf(options);
  const signals = collectSignals(readings);
  const mode = winningMode(readings);
  if (mode !== null) {
    return {
      attribution: mode,
      agent: agentFor(readings, mode),
      confidence: aiConfidence(readings),
      signals,
      version,
    };
  }
  if (readings.some((reading) => reading.result.attribution === 'human')) {
    return { attribution: 'human', agent: null, confidence: KIND_WEIGHTS.label, signals, version };
  }
  return { attribution: 'unknown', agent: null, confidence: 0, signals, version };
}

/** The classifier's label options from the policy's `aiGovernance` block. */
export function attributionOptionsOf(
  policy: { agentLabels?: string[] | undefined; assistedLabels?: string[] | undefined } | undefined,
): AttributionOptions {
  return {
    ...(policy?.agentLabels === undefined ? {} : { agentLabels: policy.agentLabels }),
    ...(policy?.assistedLabels === undefined ? {} : { assistedLabels: policy.assistedLabels }),
  };
}

/** A classification as the `pull_requests` attribution columns hold it. */
export function attributionColumns(result: PullRequestAttribution) {
  return {
    attribution: result.attribution,
    aiAgent: result.agent,
    attributionConfidence: result.confidence,
    attributionSignals: result.signals,
    attributionVersion: result.version,
  };
}
