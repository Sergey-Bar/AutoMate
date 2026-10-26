/**
 * Whether a commit or pull request was written by an AI coding agent.
 *
 * Every number on the AI-code scorecard rests on this answer, so it is built to be argued
 * with: one table of signatures, each citing where it was observed, and a classifier that
 * reports the signals it used rather than a bare verdict. Three readings matter and are
 * kept apart:
 *
 * - **agent-authored** — an agent wrote and pushed the change (a bot author, an agent
 *   branch). A human may have asked for it and may approve it, but did not type it.
 * - **ai-assisted** — a human authored the change with an AI tool in the loop (a
 *   co-author trailer, an IDE footer, Aider's author suffix).
 * - **human** — a human author and no AI signal at all.
 *
 * And a fourth that is not a kind of authorship: **unknown**, when there is no author
 * identity to read. An unknown change is never counted as human, because a scorecard that
 * folds the unattributed into the baseline would compare AI change against a group that
 * silently contains it.
 *
 * The absence of a signal is weak evidence. Every agent here can be configured to drop its
 * trailer, so `human` carries a deliberately modest confidence.
 */

export type SignatureKind =
  'bot-login' | 'trailer' | 'branch-prefix' | 'author-email' | 'author-name' | 'message-marker';

export type AttributionMode = 'agent-authored' | 'ai-assisted';

export type Attribution = AttributionMode | 'human' | 'unknown';

export interface AgentSignature {
  /** A stable tool name, never a person. */
  agent: string;
  kind: SignatureKind;
  /**
   * Lower-case. How it matches depends on the kind:
   *
   * - `bot-login` — equals the author or committer login.
   * - `trailer` — a substring of the normalised trailer line `key: value`.
   * - `branch-prefix` — the branch starts with it.
   * - `author-email` — equals the author email, or its GitHub noreply form `<id>+pattern`.
   * - `author-name` — the author name ends with it.
   * - `message-marker` — a substring of the message or PR notes; a leading `^` anchors it
   *   to the start of either instead.
   */
  pattern: string;
  mode: AttributionMode;
  /** Where the signature was observed. A row without one does not belong here. */
  source: string;
}

/**
 * The single source of truth for what an AI agent leaves behind in git and on GitHub.
 *
 * Versioned, because a signature changes when a vendor renames a bot or a trailer, and a
 * scorecard computed against an older table has to be able to say so. Only signatures
 * with a citable observation are here: an entry added on a guess would turn an unrelated
 * human's commits into "AI change". Bot logins of GitHub Apps follow GitHub's
 * `<app-slug>[bot]` convention, and the source for those rows is the app's own page.
 *
 * Deliberately absent: an Aider co-author trailer (the option exists, but its address is
 * not documented), an OpenHands co-author trailer (documented, address not published),
 * and review-only bots such as `copilot-pull-request-reviewer[bot]`, which comment on
 * change rather than write it.
 */
export const AGENT_SIGNATURES = {
  version: '2026-10-26',
  entries: [
    {
      agent: 'claude-code',
      kind: 'trailer',
      pattern: 'noreply@anthropic.com',
      mode: 'ai-assisted',
      source: 'https://github.com/anthropics/claude-code/issues/66602',
    },
    {
      agent: 'claude-code',
      kind: 'message-marker',
      pattern: 'generated with [claude code]',
      mode: 'ai-assisted',
      source: 'https://github.com/anthropics/claude-code/issues/66602',
    },
    {
      agent: 'claude-code',
      kind: 'message-marker',
      pattern: 'generated with claude code',
      mode: 'ai-assisted',
      source: 'https://github.com/anthropics/claude-code/issues/66602',
    },
    {
      agent: 'claude-code',
      kind: 'bot-login',
      pattern: 'claude[bot]',
      mode: 'agent-authored',
      source: 'https://gist.github.com/jyxjjj/290633474bee424050964f283f8b57a6',
    },
    {
      agent: 'github-copilot',
      kind: 'bot-login',
      pattern: 'copilot-swe-agent[bot]',
      mode: 'agent-authored',
      source: 'https://gist.github.com/PaulKinlan/68210b7a1c7edfce2fc2f8789065b227',
    },
    {
      agent: 'github-copilot',
      kind: 'bot-login',
      pattern: 'copilot',
      mode: 'agent-authored',
      source: 'https://github.com/orgs/community/discussions/179983',
    },
    {
      agent: 'github-copilot',
      kind: 'branch-prefix',
      pattern: 'copilot/',
      mode: 'agent-authored',
      source: 'https://github.com/orgs/community/discussions/188662',
    },
    {
      agent: 'github-copilot',
      kind: 'author-email',
      pattern: 'copilot@users.noreply.github.com',
      mode: 'agent-authored',
      source: 'https://gist.github.com/jyxjjj/290633474bee424050964f283f8b57a6',
    },
    {
      agent: 'github-copilot',
      kind: 'trailer',
      pattern: 'copilot@users.noreply.github.com',
      mode: 'ai-assisted',
      source: 'https://gist.github.com/jyxjjj/290633474bee424050964f283f8b57a6',
    },
    {
      agent: 'github-copilot',
      kind: 'trailer',
      pattern: 'copilot[bot]@users.noreply.github.com',
      mode: 'ai-assisted',
      source: 'https://gist.github.com/jyxjjj/290633474bee424050964f283f8b57a6',
    },
    {
      agent: 'github-copilot',
      kind: 'trailer',
      pattern: 'copilot@github.com',
      mode: 'ai-assisted',
      source: 'https://github.com/microsoft/vscode/issues/314311',
    },
    {
      agent: 'openai-codex',
      kind: 'bot-login',
      pattern: 'chatgpt-codex-connector[bot]',
      mode: 'agent-authored',
      source: 'https://gist.github.com/jyxjjj/290633474bee424050964f283f8b57a6',
    },
    {
      agent: 'openai-codex',
      kind: 'branch-prefix',
      pattern: 'codex/',
      mode: 'agent-authored',
      source: 'https://community.openai.com/t/branch-naming-is-there-any-way-to-set-it/1315157',
    },
    {
      agent: 'openai-codex',
      kind: 'trailer',
      pattern: 'chatgpt-codex-connector[bot]@users.noreply.github.com',
      mode: 'ai-assisted',
      source: 'https://gist.github.com/jyxjjj/290633474bee424050964f283f8b57a6',
    },
    {
      agent: 'openai-codex',
      kind: 'trailer',
      pattern: 'codex@users.noreply.github.com',
      mode: 'ai-assisted',
      source: 'https://gist.github.com/jyxjjj/290633474bee424050964f283f8b57a6',
    },
    {
      agent: 'devin',
      kind: 'bot-login',
      pattern: 'devin-ai-integration[bot]',
      mode: 'agent-authored',
      source: 'https://github.com/LeoBanned/pirate-station-cracks/pulls',
    },
    {
      agent: 'google-jules',
      kind: 'bot-login',
      pattern: 'google-labs-jules[bot]',
      mode: 'agent-authored',
      source: 'https://github.com/SumZer0-git/EDAPGui/commits',
    },
    {
      agent: 'cursor',
      kind: 'author-email',
      pattern: 'cursoragent@cursor.com',
      mode: 'agent-authored',
      source: 'https://forum.cursor.com/t/commit-attribution-opt-out-ignored/164034/5',
    },
    {
      agent: 'cursor',
      kind: 'trailer',
      pattern: 'cursoragent@cursor.com',
      mode: 'ai-assisted',
      source: 'https://mehmetbaykar.com/posts/how-to-disable-made-with-cursor-attribution/',
    },
    {
      agent: 'cursor',
      kind: 'trailer',
      pattern: 'made-with: cursor',
      mode: 'ai-assisted',
      source: 'https://mehmetbaykar.com/posts/how-to-disable-made-with-cursor-attribution/',
    },
    {
      agent: 'cursor',
      kind: 'branch-prefix',
      pattern: 'cursor/',
      mode: 'agent-authored',
      source:
        'https://forum.cursor.com/t/cursor-v1-cloud-apis-branchname-is-giving-validation-error/160393/6',
    },
    {
      agent: 'aider',
      kind: 'author-name',
      pattern: '(aider)',
      mode: 'ai-assisted',
      source: 'https://aider.chat/docs/git.html',
    },
    {
      agent: 'aider',
      kind: 'message-marker',
      pattern: '^aider:',
      mode: 'ai-assisted',
      source: 'https://aider.chat/docs/git.html',
    },
    {
      agent: 'amazon-q-developer',
      kind: 'bot-login',
      pattern: 'amazon-q-developer[bot]',
      mode: 'agent-authored',
      source: 'https://github.com/apps/amazon-q-developer',
    },
    {
      agent: 'openhands',
      kind: 'bot-login',
      pattern: 'openhands-agent',
      mode: 'agent-authored',
      source: 'https://github.com/openhands-agent',
    },
    {
      agent: 'sweep',
      kind: 'bot-login',
      pattern: 'sweep-ai[bot]',
      mode: 'agent-authored',
      source: 'https://github.com/suenot/meklaw-moex-trading/pull/1/files',
    },
    {
      agent: 'kiro',
      kind: 'bot-login',
      pattern: 'kiro-agent[bot]',
      mode: 'agent-authored',
      source: 'https://github.com/apps/kiro-agent',
    },
    {
      agent: 'gemini-code-assist',
      kind: 'trailer',
      pattern: 'gemini-code-assist',
      mode: 'ai-assisted',
      source: 'https://gist.github.com/jyxjjj/290633474bee424050964f283f8b57a6',
    },
  ],
} as const satisfies { version: string; entries: readonly AgentSignature[] };

export type SignalKind = SignatureKind | 'label';

/**
 * How much one signal of each kind says on its own.
 *
 * A bot login is set by the platform and is hard to fake by accident; a branch prefix is
 * a convention a human can follow too; a label is applied by a person and is the weakest.
 * `human` is reported at the label weight, the floor, so that adding any signal can never
 * make a classification less confident (invariant ATTR-1).
 */
export const KIND_WEIGHTS: Readonly<Record<SignalKind, number>> = {
  'bot-login': 0.95,
  'author-email': 0.9,
  trailer: 0.8,
  'author-name': 0.8,
  'message-marker': 0.7,
  'branch-prefix': 0.6,
  label: 0.5,
};

/** The trailer keys that attribute authorship. `Made-with` is Cursor's. */
const ATTRIBUTION_TRAILER_KEYS: ReadonlySet<string> = new Set([
  'co-authored-by',
  'assisted-by',
  'generated-by',
  'made-with',
]);

const TRAILER_LINE = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(\S.*)$/u;

export interface AttributionSubject {
  authorLogin?: string | null;
  authorEmail?: string | null;
  authorName?: string | null;
  committerLogin?: string | null;
  message?: string | null;
  branch?: string | null;
  labels?: readonly string[];
  /** A pull request body, where agents put their footers. */
  notes?: string | null;
}

export interface AttributionOptions {
  agentLabels?: readonly string[];
  assistedLabels?: readonly string[];
}

export interface AttributionSignal {
  kind: SignalKind;
  detail: string;
}

export interface AttributionResult {
  attribution: Attribution;
  agent: string | null;
  /** 0..1. */
  confidence: number;
  signals: AttributionSignal[];
}

export interface Trailer {
  /** Lower-cased, because git trailer keys are case-insensitive. */
  key: string;
  value: string;
}

/**
 * The trailers of a commit message: the `Key: value` lines of its final paragraph.
 *
 * Only the final paragraph, as git reads them, and only when every line of it is a
 * trailer — a `Co-authored-by:` quoted in the body is prose about a co-author, not a
 * claim of one. The subject is never a trailer block, which is what keeps a conventional
 * commit subject such as `fix: x` from reading as a trailer keyed `fix`.
 */
export function parseTrailers(message: string | null | undefined): Trailer[] {
  if (message === null || message === undefined) return [];
  const paragraphs = message
    .replace(/\r\n?/gu, '\n')
    .trim()
    .split(/\n[ \t]*\n/u);
  if (paragraphs.length < 2) return [];
  const lines = (paragraphs[paragraphs.length - 1] as string).split('\n');
  const trailers: Trailer[] = [];
  for (const line of lines) {
    const match = TRAILER_LINE.exec(line.trim());
    if (match === null) return [];
    trailers.push({ key: (match[1] as string).toLowerCase(), value: (match[2] as string).trim() });
  }
  return trailers;
}

interface Match {
  signal: AttributionSignal;
  mode: AttributionMode | null;
  agent: string | null;
  /** Whether it is evidence of AI. A non-AI bot is reported but weighs nothing. */
  ai: boolean;
}

function present(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function emailMatches(email: string, pattern: string): boolean {
  if (email === pattern) return true;
  const plus = email.indexOf('+');
  return plus > 0 && /^\d+$/u.test(email.slice(0, plus)) && email.slice(plus + 1) === pattern;
}

function markerMatches(texts: readonly string[], pattern: string): boolean {
  if (pattern.startsWith('^')) {
    const anchored = pattern.slice(1);
    return texts.some((text) => text.trimStart().startsWith(anchored));
  }
  return texts.some((text) => text.includes(pattern));
}

/** The parts of a subject the signature table is matched against, normalised once. */
interface SubjectReadings {
  login: string | null;
  committer: string | null;
  email: string | null;
  name: string | null;
  branch: string | null;
  trailers: { key: string; line: string }[];
  texts: string[];
  authorIsHuman: boolean;
}

function lowered(value: string | null | undefined): string | null {
  return present(value)?.toLowerCase() ?? null;
}

function readSubject(subject: AttributionSubject, authorIsHuman: boolean): SubjectReadings {
  return {
    login: lowered(subject.authorLogin),
    committer: lowered(subject.committerLogin),
    email: lowered(subject.authorEmail),
    name: lowered(subject.authorName),
    branch: lowered(subject.branch),
    trailers: parseTrailers(subject.message)
      .filter((trailer) => ATTRIBUTION_TRAILER_KEYS.has(trailer.key))
      .map((trailer) => ({
        key: trailer.key,
        line: `${trailer.key}: ${trailer.value.toLowerCase()}`,
      })),
    texts: [present(subject.message), present(subject.notes)]
      .filter((text): text is string => text !== null)
      .map((text) => text.toLowerCase()),
    authorIsHuman,
  };
}

type AddMatch = (entry: AgentSignature, detail: string, mode?: AttributionMode) => void;
type SignatureMatcher = (entry: AgentSignature, read: SubjectReadings, add: AddMatch) => void;

/** How each kind of signature is matched; see {@link AgentSignature.pattern}. */
const SIGNATURE_MATCHERS: Readonly<Record<SignatureKind, SignatureMatcher>> = {
  'bot-login': (entry, read, add) => {
    const { pattern } = entry;
    if (read.login === pattern) add(entry, `author ${pattern} is ${entry.agent}`);
    // An agent committing what a named human authored is assistance, not authorship.
    if (read.committer === pattern) {
      add(
        entry,
        `committer ${pattern} is ${entry.agent}`,
        read.authorIsHuman ? 'ai-assisted' : entry.mode,
      );
    }
  },
  trailer: (entry, read, add) => {
    for (const trailer of read.trailers) {
      if (trailer.line.includes(entry.pattern)) {
        add(entry, `${trailer.key} trailer matches "${entry.pattern}" (${entry.agent})`);
      }
    }
  },
  'branch-prefix': (entry, read, add) => {
    if (read.branch?.startsWith(entry.pattern) === true) {
      add(entry, `branch starts with ${entry.pattern} (${entry.agent})`);
    }
  },
  'author-email': (entry, read, add) => {
    if (read.email !== null && emailMatches(read.email, entry.pattern)) {
      add(entry, `author email is ${entry.pattern} (${entry.agent})`);
    }
  },
  'author-name': (entry, read, add) => {
    if (read.name?.endsWith(entry.pattern) === true) {
      add(entry, `author name ends with ${entry.pattern} (${entry.agent})`);
    }
  },
  'message-marker': (entry, read, add) => {
    if (markerMatches(read.texts, entry.pattern)) {
      add(entry, `text carries "${entry.pattern}" (${entry.agent})`);
    }
  },
};

function signatureMatches(subject: AttributionSubject, authorIsHuman: boolean): Match[] {
  const read = readSubject(subject, authorIsHuman);
  const matches: Match[] = [];
  const add: AddMatch = (entry, detail, mode = entry.mode) =>
    matches.push({ signal: { kind: entry.kind, detail }, mode, agent: entry.agent, ai: true });

  for (const entry of AGENT_SIGNATURES.entries as readonly AgentSignature[]) {
    SIGNATURE_MATCHERS[entry.kind](entry, read, add);
  }
  return matches;
}

function labelMatches(subject: AttributionSubject, options: AttributionOptions): Match[] {
  const matches: Match[] = [];
  const configured = (mode: AttributionMode, list: readonly string[] | undefined) => {
    const wanted = new Set((list ?? []).map((label) => label.trim().toLowerCase()));
    for (const label of subject.labels ?? []) {
      const normalised = label.trim().toLowerCase();
      if (wanted.has(normalised)) {
        matches.push({
          signal: { kind: 'label', detail: `label "${normalised}" marks ${mode} change` },
          mode,
          agent: null,
          ai: true,
        });
      }
    }
  };
  configured('agent-authored', options.agentLabels);
  configured('ai-assisted', options.assistedLabels);
  return matches;
}

/**
 * How the classifier words the signal for a bot author that is not an AI agent. That signal
 * is recorded and is not AI evidence; a roll-up over stored signals recognises it by this.
 */
export const NOT_AI_BOT_DETAIL = 'is a bot that is not an AI agent';

/**
 * Noisy-OR over the distinct kinds of AI evidence: two trailers are one piece of evidence,
 * not two. The one confidence rule, for a single subject and for a pull request's roll-up.
 */
export function confidenceOfKinds(kinds: Iterable<SignalKind>): number {
  let doubt = 1;
  for (const kind of new Set(kinds)) doubt *= 1 - KIND_WEIGHTS[kind];
  return 1 - doubt;
}

function combinedConfidence(matches: readonly Match[]): number {
  return confidenceOfKinds(matches.filter((match) => match.ai).map((match) => match.signal.kind));
}

function namedAgent(matches: readonly Match[], mode: AttributionMode): string | null {
  const pick = (pool: readonly Match[]) => {
    const counts = new Map<string, number>();
    for (const match of pool) {
      if (match.agent !== null) counts.set(match.agent, (counts.get(match.agent) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    // Map iteration is insertion order, which is table order: a tie goes to the earlier row.
    for (const [agent, count] of counts) {
      if (count > bestCount) {
        best = agent;
        bestCount = count;
      }
    }
    return best;
  };
  return pick(matches.filter((match) => match.mode === mode)) ?? pick(matches);
}

/**
 * Classify one commit or pull request.
 *
 * Agent-authored wins over ai-assisted whenever both appear, because the stronger claim is
 * the one a governance rule has to act on: an agent branch carrying a human co-author
 * trailer is still a change an agent pushed. Confidence is a noisy-OR over the distinct
 * kinds of AI evidence found — it measures how sure the reading is that AI was involved,
 * and grows with independent signals; it is computed over every AI signal rather than only
 * the winning mode's, so a new signal can never make the answer less certain (ATTR-1).
 *
 * With no author identity and no signal the answer is `unknown`, never `human` (ATTR-2).
 * With no identity but an AI signal, the signal decides: AI involvement is known even
 * when the human is not.
 */
export function classifyAttribution(
  subject: AttributionSubject,
  options: AttributionOptions = {},
): AttributionResult {
  const login = present(subject.authorLogin)?.toLowerCase() ?? null;
  const hasIdentity =
    login !== null || present(subject.authorEmail) !== null || present(subject.authorName) !== null;
  const authorIsAgentBot = AGENT_SIGNATURES.entries.some(
    (entry) => entry.kind === 'bot-login' && entry.pattern === login,
  );
  const authorIsBot = authorIsAgentBot || login?.endsWith('[bot]') === true;
  const provisionalHuman = hasIdentity && !authorIsBot;

  const matches = [
    ...signatureMatches(subject, provisionalHuman),
    ...labelMatches(subject, options),
  ];
  const authoredByAgentEmail = matches.some(
    (match) => match.signal.kind === 'author-email' && match.mode === 'agent-authored',
  );
  const humanAuthor = provisionalHuman && !authoredByAgentEmail;

  if (authorIsBot && !authorIsAgentBot) {
    matches.push({
      signal: { kind: 'bot-login', detail: `author ${login} ${NOT_AI_BOT_DETAIL}` },
      mode: null,
      agent: null,
      ai: false,
    });
  }

  const signals = matches.map((match) => match.signal);
  const mode: AttributionMode | null = matches.some((match) => match.mode === 'agent-authored')
    ? 'agent-authored'
    : matches.some((match) => match.mode === 'ai-assisted')
      ? 'ai-assisted'
      : null;

  if (mode !== null) {
    return {
      attribution: mode,
      agent: namedAgent(matches, mode),
      confidence: combinedConfidence(matches),
      signals,
    };
  }
  if (humanAuthor) {
    return { attribution: 'human', agent: null, confidence: KIND_WEIGHTS.label, signals };
  }
  return { attribution: 'unknown', agent: null, confidence: 0, signals };
}
