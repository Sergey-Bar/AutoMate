import { createHash } from 'node:crypto';
import type {
  CanonicalFinding,
  FindingKind,
  FindingSeverity,
  HealthDimension,
} from '@automate/shared-contracts';

/**
 * The agent's instructions and MCP configuration, scanned as supply-chain input.
 *
 * ## Why this is its own scanner
 *
 * `AGENTS.md`, `CLAUDE.md`, Cursor rules, Copilot instructions, Kiro steering, every
 * `SKILL.md` and every MCP config are text and settings a coding agent obeys with implicit
 * trust (OWASP LLM01:2025, prompt injection; Invariant Labs, MCP tool poisoning). No source
 * scanner reads them as instructions, so a repository that is clean to Semgrep and gitleaks
 * can still tell its agent to post `~/.ssh` to a webhook, or launch an MCP server with
 * `npx -y something@latest` that changes under it on every start.
 *
 * ## Pure, and deliberately narrow
 *
 * File contents in, findings out; nothing is read, fetched or executed. Every text rule is a
 * phrase list with a reason, not a classifier, because the repository's own `pnpm skill-scan`
 * (SkillSpector) taught the cost of the other approach: it returned `DO_NOT_INSTALL` over a
 * React README sentence ("Define clear context interfaces") and a `dangerouslySetInnerHTML`
 * inside a fenced code block. So the guards below are part of the contract and tested:
 *
 * - **Code is not instructions.** The prompt-injection and exfiltration phrase rules skip
 *   fenced code blocks (```` ``` ```` and `~~~`, CommonMark: up to three spaces of indent, the
 *   closing fence the same character and at least as long; an unclosed fence runs to the end
 *   of the file) and inline code spans (a backtick run closed by a run of the same length on
 *   the same line). Documentation that quotes an attack in a code block is teaching, not
 *   attacking.
 * - **Quoting is not instructing.** A sentence containing "e.g.", "for example" or "such as"
 *   is skipped by the same two rules. The unit is the sentence, split on `.`, `!` or `?`
 *   followed by a space or the end of the line, so "Phrases such as these are bad. Ignore all
 *   previous instructions." still fires on its second sentence. Sentences are read per line:
 *   a phrase wrapped across two lines is missed, which is the false-negative side of the
 *   trade and is stated rather than hidden.
 * - **A secret is a secret anywhere.** Secret patterns run on every line, code blocks
 *   included — a real token in a fenced example is still a leaked token. Placeholders
 *   (`EXAMPLE`, `your`, `xxxx`, fewer than six distinct characters) are not.
 * - **Invisible characters are checked everywhere**, code and JSON included: a zero-width or
 *   bidirectional control character has no legitimate use in an instruction file, and in code
 *   it is the Trojan Source attack.
 *
 * ## MCP configuration is parsed, not pattern-matched
 *
 * `mcpServers` (Claude, Cursor, Kiro, Windsurf, Gemini) and `servers` (VS Code) are read
 * structurally, so a server's launch command, version pin, transport and env *names* become
 * an inventory row, and a rule can tell an `args` credential from an `env` one. Config files
 * are JSONC in practice (VS Code and Kiro accept comments and trailing commas), hence
 * `stripJsonc`; a file that still does not parse is one `unparseable` info finding rather
 * than a crash or a silent pass — a config nobody could read was not checked.
 */

export const AGENT_CONFIG_TOOL = 'automate-agent-config';

/**
 * Where coding agents read instructions and MCP configuration, as repository-relative
 * patterns. `**` is any number of directories (including none), `*` is within one segment.
 * Matching is case-insensitive because the same repository is checked out on Windows and
 * macOS, where `agents.md` and `AGENTS.md` are the same file.
 */
export const AGENT_CONFIG_PATHS: readonly string[] = Object.freeze([
  // Instructions
  '**/AGENTS.md',
  '**/CLAUDE.md',
  '**/CLAUDE.local.md',
  '**/GEMINI.md',
  '.claude/agents/*.md',
  '.claude/commands/*.md',
  '.cursorrules',
  '.cursor/rules/**/*.mdc',
  '.github/copilot-instructions.md',
  '.github/instructions/**/*.instructions.md',
  '.github/prompts/*.prompt.md',
  '.windsurfrules',
  '.windsurf/rules/*.md',
  '.kiro/steering/*.md',
  '.kilo/agent/*.md',
  '**/SKILL.md',
  // Settings and MCP
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.mcp.json',
  '.cursor/mcp.json',
  '.vscode/mcp.json',
  '.kiro/settings/mcp.json',
  '.gemini/settings.json',
  '**/claude_desktop_config.json',
]);

const PATTERN_SEGMENTS = AGENT_CONFIG_PATHS.map((pattern) => pattern.toLowerCase().split('/'));

function normalisePath(path: string): string {
  return path.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
}

/** One segment against one pattern segment holding at most one `*`. */
function segmentMatches(pattern: string, segment: string): boolean {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === segment;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return (
    segment.length >= prefix.length + suffix.length &&
    segment.startsWith(prefix) &&
    segment.endsWith(suffix)
  );
}

/** Segment-wise glob matching, so no pattern is compiled into a regular expression. */
function globMatches(
  pattern: readonly string[],
  i: number,
  path: readonly string[],
  j: number,
): boolean {
  if (i === pattern.length) return j === path.length;
  const head = pattern[i] as string;
  if (head === '**') {
    return (
      globMatches(pattern, i + 1, path, j) ||
      (j < path.length && globMatches(pattern, i, path, j + 1))
    );
  }
  return (
    j < path.length &&
    segmentMatches(head, path[j] as string) &&
    globMatches(pattern, i + 1, path, j + 1)
  );
}

/** Whether a repository-relative path is a file a coding agent reads as instructions or MCP config. */
export function isAgentConfigPath(path: string): boolean {
  const normalised = normalisePath(path).toLowerCase();
  if (normalised.length === 0) return false;
  const segments = normalised.split('/');
  return PATTERN_SEGMENTS.some((pattern) => globMatches(pattern, 0, segments, 0));
}

// ─── Rules ──────────────────────────────────────────────────────────────────

export type AgentConfigRuleId =
  | 'agent-config/prompt-injection'
  | 'agent-config/exfiltration'
  | 'agent-config/embedded-secret'
  | 'agent-config/mcp-unpinned'
  | 'agent-config/mcp-auto-install'
  | 'agent-config/mcp-plaintext-remote'
  | 'agent-config/mcp-secret-in-args'
  | 'agent-config/over-broad-permission'
  | 'agent-config/unparseable';

export interface AgentConfigRule {
  kind: FindingKind;
  severity: FindingSeverity;
  dimension: HealthDimension;
  /** A public reference for the class of issue, or `null` when none is authoritative. */
  helpUri: string | null;
  description: string;
}

const OWASP_LLM01 = 'https://genai.owasp.org/llmrisk/llm01-prompt-injection/';
const INVARIANT_TOOL_POISONING =
  'https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks';
const KIRO_MCP_CONFIGURATION = 'https://kiro.dev/docs/mcp/configuration/';

export const AGENT_CONFIG_RULES: Readonly<Record<AgentConfigRuleId, AgentConfigRule>> = {
  'agent-config/prompt-injection': {
    kind: 'issue',
    severity: 'high',
    dimension: 'ai-governance',
    helpUri: OWASP_LLM01,
    description:
      'Instruction-override phrases, hidden HTML-comment instructions to the model, invisible or bidirectional control characters, or a long base64 blob in prose.',
  },
  'agent-config/exfiltration': {
    kind: 'issue',
    severity: 'high',
    dimension: 'security',
    helpUri: INVARIANT_TOOL_POISONING,
    description:
      'An instruction to send secrets, env or files to a network destination, to read credential files alongside a network verb, or to pipe a download into a shell.',
  },
  'agent-config/embedded-secret': {
    kind: 'secret',
    severity: 'critical',
    dimension: 'security',
    helpUri: null,
    description: 'A credential written into an agent instruction file or an MCP config value.',
  },
  'agent-config/mcp-unpinned': {
    kind: 'issue',
    severity: 'medium',
    dimension: 'ai-governance',
    helpUri: null,
    description:
      'An MCP server fetched at launch (npx, pnpm dlx, bunx, uvx, pipx run, docker run) without an exact version or digest, or pinned to a moving tag.',
  },
  'agent-config/mcp-auto-install': {
    kind: 'issue',
    severity: 'low',
    dimension: 'ai-governance',
    helpUri: null,
    description: 'An MCP server launched with `npx -y` / `--yes`, which installs without asking.',
  },
  'agent-config/mcp-plaintext-remote': {
    kind: 'issue',
    severity: 'high',
    dimension: 'security',
    helpUri: null,
    description: 'A remote MCP server reached over plain http:// to a host that is not loopback.',
  },
  'agent-config/mcp-secret-in-args': {
    kind: 'secret',
    severity: 'critical',
    dimension: 'security',
    helpUri: null,
    description:
      'A credential passed in an MCP server’s command-line args or URL query string, where process listings and logs see it.',
  },
  'agent-config/over-broad-permission': {
    kind: 'issue',
    severity: 'medium',
    dimension: 'ai-governance',
    helpUri: null,
    description:
      'A documented setting that approves every tool call: Claude `permissions.allow` of Bash / Bash(*) / *, `defaultMode: bypassPermissions`, `enableAllProjectMcpServers`, Kiro `autoApprove: ["*"]`, Cline `alwaysAllow: ["*"]`, Gemini `trust: true`, or a skip-approval CLI flag.',
  },
  'agent-config/unparseable': {
    kind: 'issue',
    severity: 'info',
    dimension: 'ai-governance',
    helpUri: null,
    description: 'A JSON/JSONC agent config that does not parse, so nothing in it was checked.',
  },
};

// ─── Public shape ───────────────────────────────────────────────────────────

export interface AgentConfigFile {
  path: string;
  text: string;
}

export type McpTransport = 'stdio' | 'http' | 'sse' | 'unknown';

export interface McpServerEntry {
  name: string;
  configPath: string;
  transport: McpTransport;
  command: string | null;
  /** The package or image fetched at launch, or a local path; `null` when nothing is. */
  package: string | null;
  version: string | null;
  /** `true` when nothing is fetched at launch, or the fetch is an exact version or digest. */
  pinned: boolean;
  url: string | null;
  /** Variable names only. A value is never copied into the inventory. */
  envKeys: string[];
}

export interface AgentConfigScan {
  findings: CanonicalFinding[];
  mcpServers: McpServerEntry[];
  filesScanned: number;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * The finding identity: sha256 of rule, path and the normalised match — never the line, so a
 * finding does not become "new" because a line was added above it. For a secret the match is
 * the secret itself; a sha256 of a high-entropy token does not disclose it.
 */
function fingerprint(ruleId: AgentConfigRuleId, path: string, match: string): string {
  return createHash('sha256').update(`${ruleId}\u0000${path}\u0000${match}`).digest('hex');
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** The 1-based line of the first `needle` at or after `from`, or `null` when it is not in the source. */
function lineOf(text: string, needle: string, from = 0): number | null {
  const index = text.indexOf(needle, from);
  return index < 0 ? null : lineAt(text, index);
}

class Findings {
  private readonly byFingerprint = new Map<string, CanonicalFinding>();

  add(
    ruleId: AgentConfigRuleId,
    path: string,
    line: number | null,
    match: string,
    message: string,
    helpUri?: string | null,
  ): void {
    const rule = AGENT_CONFIG_RULES[ruleId];
    const id = fingerprint(ruleId, path, match);
    if (this.byFingerprint.has(id)) return;
    this.byFingerprint.set(id, {
      fingerprint: id,
      tool: AGENT_CONFIG_TOOL,
      ruleId,
      kind: rule.kind,
      severity: rule.severity,
      dimension: rule.dimension,
      path: path.slice(0, 1000),
      line,
      message: message.slice(0, 4000),
      helpUri: helpUri === undefined ? rule.helpUri : helpUri,
      fixAvailable: null,
    });
  }

  list(): CanonicalFinding[] {
    return [...this.byFingerprint.values()];
  }
}

// ─── Secrets ────────────────────────────────────────────────────────────────

interface SecretPattern {
  label: string;
  pattern: RegExp;
  /** Real keys of this family always contain a digit; prose that merely looks like one does not. */
  needsDigit: boolean;
}

/**
 * Published token prefixes. Each is one character class under one bounded quantifier, so no
 * pattern can backtrack catastrophically. Anthropic is listed before OpenAI and the OpenAI
 * pattern refuses `sk-ant-`, so one key is one finding.
 */
const SECRET_PATTERNS: readonly SecretPattern[] = [
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/gu, needsDigit: false },
  {
    label: 'GitHub fine-grained token',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/gu,
    needsDigit: false,
  },
  { label: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu, needsDigit: false },
  { label: 'Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/gu, needsDigit: true },
  { label: 'OpenAI key', pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/gu, needsDigit: true },
  { label: 'Slack token', pattern: /\bxox[abpr]-[A-Za-z0-9-]{10,}/gu, needsDigit: false },
  { label: 'private key', pattern: /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/gu, needsDigit: false },
  { label: 'bearer token', pattern: /\bBearer[ \t]+([A-Za-z0-9._~+/=-]{20,})/gu, needsDigit: true },
];

const PLACEHOLDER_WORDS = ['example', 'your', 'xxxx', 'placeholder', 'changeme', 'dummy'];

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_WORDS.some((word) => lower.includes(word)) || new Set(value).size < 6;
}

interface SecretHit {
  label: string;
  value: string;
}

function secretsIn(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const { label, pattern, needsDigit } of SECRET_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      if (label !== 'private key' && looksLikePlaceholder(value)) continue;
      if (needsDigit && !/\d/u.test(value)) continue;
      hits.push({ label, value });
    }
  }
  return hits;
}

/** `${VAR}`, `${env:VAR}`, `${input:x}`, `$VAR`, `%VAR%`: a reference to a secret, not one. */
function isReference(value: string): boolean {
  return value.includes('${') || /^\$[A-Za-z_]/u.test(value) || /%[A-Za-z_]\w*%/u.test(value);
}

/**
 * A literal that could be a credential when it sits under a credential-named key or flag.
 * Twelve or more token characters with a letter, a digit and six distinct characters: short
 * enough to catch API keys, strict enough that `debug`, `true` and file paths are not.
 */
function isLiteralCredential(value: string | undefined): value is string {
  return (
    value !== undefined &&
    !isReference(value) &&
    /^[\w+=.~-]{12,}$/u.test(value) &&
    /\d/u.test(value) &&
    /[A-Za-z]/u.test(value) &&
    !looksLikePlaceholder(value)
  );
}

const CREDENTIAL_WORDS = new Set([
  'token',
  'secret',
  'password',
  'passwd',
  'pat',
  'key',
  'apikey',
  'credential',
  'credentials',
]);

/** The *last* word decides, so `GITHUB_TOKEN` and `--api-key` count and `--key-file` and `--tokenizer` do not. */
function isCredentialName(name: string): boolean {
  const words = name.toLowerCase().split(/[-_.]/u);
  return CREDENTIAL_WORDS.has(words[words.length - 1] as string);
}

// ─── Invisible characters ───────────────────────────────────────────────────

/** Zero-width and bidi controls (Trojan Source) and the Unicode Tags block (CSA, 2026). */
function isInvisibleControl(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

function checkInvisible(lines: readonly string[], path: string, findings: Findings): void {
  lines.forEach((line, index) => {
    const codes = new Set<string>();
    for (const character of line) {
      const code = character.codePointAt(0) as number;
      if (isInvisibleControl(code))
        codes.add(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
    }
    if (codes.size === 0) return;
    const list = [...codes].join(', ');
    findings.add(
      'agent-config/prompt-injection',
      path,
      index + 1,
      `invisible:${list}`,
      `Line contains invisible or bidirectional control characters (${list}); the model reads text a reviewer cannot see.`,
    );
  });
}

// ─── Prose: the markdown view with code removed ─────────────────────────────

const FENCE = /^ {0,3}(`{3,}|~{3,})/u;

/** Inline code spans replaced by spaces; an unmatched backtick run is left as text, as CommonMark does. */
function blankInlineCode(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i];
      i += 1;
      continue;
    }
    let run = 0;
    while (line[i + run] === '`') run += 1;
    const close = closingRun(line, i + run, run);
    if (close < 0) {
      out += '`'.repeat(run);
      i += run;
    } else {
      out += ' '.repeat(close + run - i);
      i = close + run;
    }
  }
  return out;
}

/** The index of the next backtick run of exactly `length` at or after `from`, or -1. */
function closingRun(line: string, from: number, length: number): number {
  let i = from;
  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1;
      continue;
    }
    let run = 0;
    while (line[i + run] === '`') run += 1;
    if (run === length) return i;
    i += run;
  }
  return -1;
}

/** Each line with fenced blocks emptied and inline code blanked, line numbers preserved. */
function proseLines(lines: readonly string[]): string[] {
  let fence: { char: string; length: number } | null = null;
  return lines.map((line) => {
    const match = FENCE.exec(line);
    if (fence !== null) {
      const run = match?.[1];
      if (
        run !== undefined &&
        run[0] === fence.char &&
        run.length >= fence.length &&
        line.slice((match as RegExpExecArray)[0].length).trim() === ''
      ) {
        fence = null;
      }
      return '';
    }
    if (match !== null) {
      const run = match[1] as string;
      fence = { char: run[0] as string, length: run.length };
      return '';
    }
    return blankInlineCode(line);
  });
}

/** Sentences of one whitespace-collapsed line, with "e.g." and "i.e." masked so they do not split one. */
function sentences(line: string): string[] {
  const masked = line.replace(/\s+/gu, ' ').replace(/\b([ei])\.([ge])\./giu, '$1~$2~');
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < masked.length; i += 1) {
    const character = masked[i];
    if (
      (character === '.' || character === '!' || character === '?') &&
      (i + 1 === masked.length || masked[i + 1] === ' ')
    ) {
      out.push(masked.slice(start, i + 1));
      start = i + 1;
    }
  }
  out.push(masked.slice(start));
  return out.map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

/** A sentence that quotes a phrase as an example is documentation, not an instruction. */
function quotesAnExample(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return lower.includes('e~g~') || lower.includes('for example') || lower.includes('such as');
}

/**
 * Instruction-override phrases. Whitespace is collapsed before matching, so each pattern uses
 * literal spaces and no group is both quantified and contains a quantifier. "You are now" is
 * narrowed to the persona-swap forms: bare, it matches "you are now ready to deploy".
 */
const OVERRIDE_PHRASES: readonly RegExp[] = [
  /\bignore (?:all |any )?(?:the |your )?(?:previous|prior|above|earlier|preceding) (?:instructions|prompts|rules|messages|directions)\b/iu,
  /\bdisregard (?:all |any )?(?:the |your )?(?:previous |prior |above )?(?:instructions|system prompt|rules|guidelines)\b/iu,
  /\bforget (?:all |everything |your )?(?:previous |prior )?(?:instructions|rules)\b/iu,
  /\byou are now (?:an? (?:unrestricted|unfiltered|jailbroken|uncensored|evil|different|new)\b|dan\b|in developer mode|no longer bound|free from)/iu,
  /\b(?:do not|don't|never) (?:tell|inform|notify|alert|warn) the user\b/iu,
  /\bwithout (?:telling|informing|notifying|alerting) the user\b/iu,
  /\bhide (?:this|it) from the user\b/iu,
  // The tag Invariant Labs' tool-poisoning proof of concept wraps its hidden instructions in.
  /<important>/iu,
];

/** 120+ base64 characters with both cases and a digit: an encoded payload, not a word. */
const BASE64_BLOB = /[A-Za-z0-9+/]{120,}={0,2}/gu;

const PIPE_TO_SHELL = /\b(?:curl|wget)\b[^|]*\| ?(?:sudo )?(?:ba|z)?sh\b/iu;
const NETWORK_VERB = /\b(?:send|post|upload|exfiltrate|transmit|forward|leak|submit|curl|wget)\b/iu;
const SENSITIVE_OBJECT =
  /\b(?:env(?:ironment)? variables?|secrets?|tokens?|api keys?|credentials?|passwords?|private keys?|ssh keys?|files|data)\b/iu;
const DESTINATION =
  /https?:\/\/|\bto (?:the |a |an |this |that )?(?:server|endpoint|webhook|url|remote|attacker)\b/iu;
const SENSITIVE_PATH =
  /~\/\.ssh\b|\bid_(?:rsa|ed25519|ecdsa)\b|\.aws\/credentials\b|(?<![\w.])\.env(?!\.?\w)/iu;

function checkSentence(sentence: string, path: string, line: number, findings: Findings): void {
  for (const phrase of OVERRIDE_PHRASES) {
    const match = phrase.exec(sentence);
    if (match === null) continue;
    const text = match[0].toLowerCase();
    findings.add(
      'agent-config/prompt-injection',
      path,
      line,
      text,
      `Instruction-override phrase "${text}" in agent instructions.`,
    );
  }
  for (const match of sentence.matchAll(BASE64_BLOB)) {
    const blob = match[0];
    if (!/[A-Z]/u.test(blob) || !/[a-z]/u.test(blob) || !/\d/u.test(blob)) continue;
    findings.add(
      'agent-config/prompt-injection',
      path,
      line,
      `base64:${blob}`,
      `A ${String(blob.length)}-character base64 blob in prose; an encoded instruction is one a reviewer cannot read.`,
    );
  }
  const pipe = PIPE_TO_SHELL.test(sentence);
  const exfiltrates =
    NETWORK_VERB.test(sentence) &&
    ((SENSITIVE_OBJECT.test(sentence) && DESTINATION.test(sentence)) ||
      SENSITIVE_PATH.test(sentence));
  if (!pipe && !exfiltrates) return;
  findings.add(
    'agent-config/exfiltration',
    path,
    line,
    sentence.toLowerCase(),
    pipe
      ? 'Instruction pipes a download into a shell, running whatever the server returns.'
      : 'Instruction sends credentials, environment or files to a network destination.',
  );
}

const MODEL_ADDRESSEE =
  /\b(?:ai|assistant|llm|model|agent|claude|copilot|cursor|gemini|chatgpt|gpt)\b/iu;
const IMPERATIVE =
  /\b(?:you must|you should|you will|ignore|do not|don't|never|always|secretly|instead|make sure)\b/iu;

/** `<!-- … -->` is invisible in rendered markdown and fully visible to the model. */
function checkHtmlComments(prose: string, path: string, findings: Findings): void {
  let from = 0;
  for (;;) {
    const open = prose.indexOf('<!--', from);
    if (open < 0) return;
    const close = prose.indexOf('-->', open + 4);
    if (close < 0) return;
    const body = prose
      .slice(open + 4, close)
      .replace(/\s+/gu, ' ')
      .trim();
    from = close + 3;
    if (!MODEL_ADDRESSEE.test(body) || !IMPERATIVE.test(body)) continue;
    findings.add(
      'agent-config/prompt-injection',
      path,
      lineAt(prose, open),
      `comment:${body.toLowerCase().slice(0, 500)}`,
      'A hidden HTML comment addresses the model with an instruction the rendered page does not show.',
    );
  }
}

function scanProse(path: string, text: string, findings: Findings): void {
  const lines = text.split(/\r?\n/u);
  checkInvisible(lines, path, findings);
  lines.forEach((line, index) => {
    for (const hit of secretsIn(line)) {
      findings.add(
        'agent-config/embedded-secret',
        path,
        index + 1,
        hit.value,
        `${hit.label} written into agent instructions; rotate it and load it from the environment.`,
      );
    }
  });
  const prose = proseLines(lines);
  prose.forEach((line, index) => {
    for (const sentence of sentences(line)) {
      if (!quotesAnExample(sentence)) checkSentence(sentence, path, index + 1, findings);
    }
  });
  checkHtmlComments(prose.join('\n'), path, findings);
}

// ─── JSONC ──────────────────────────────────────────────────────────────────

/**
 * JSONC to JSON: comments become spaces (newlines kept, so line numbers survive) and a comma
 * followed only by whitespace before `}` or `]` becomes a space. String contents, including
 * `//` in a URL and escaped quotes, are left alone. Two passes so a comment between a
 * trailing comma and its bracket is already gone when the comma is judged.
 */
export function stripJsonc(text: string): string {
  return stripTrailingCommas(stripComments(text));
}

function blank(text: string): string {
  return text.replace(/[^\n]/gu, ' ');
}

function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const character = text[i] as string;
    if (character === '"') {
      const stop = stringEnd(text, i);
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    const stop = commentEnd(text, i);
    if (stop !== null) {
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    out += character;
    i += 1;
  }
  return out;
}

/**
 * The index just past the string literal opening at `open`, its contents — escaped quotes
 * included — skipped verbatim. An unterminated string runs to the end of the text.
 */
function stringEnd(text: string, open: number): number {
  let i = open + 1;
  while (i < text.length) {
    const character = text[i] as string;
    if (character === '\\' && i + 1 < text.length) {
      i += 2;
    } else if (character === '"') {
      return i + 1;
    } else {
      i += 1;
    }
  }
  return text.length;
}

/**
 * Where a comment starting at `i` ends: a line comment before its newline, a block comment
 * just past its closing star-slash (or at the end of an unterminated one). `null` when no
 * comment starts at `i`.
 */
function commentEnd(text: string, i: number): number | null {
  if (text[i] !== '/') return null;
  const next = text[i + 1];
  if (next === '/') {
    const end = text.indexOf('\n', i);
    return end < 0 ? text.length : end;
  }
  if (next === '*') {
    const end = text.indexOf('*/', i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return null;
}

function stripTrailingCommas(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const character = text[i] as string;
    if (character === '"') {
      const stop = stringEnd(text, i);
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    out += character === ',' && closesAfterWhitespace(text, i + 1) ? ' ' : character;
    i += 1;
  }
  return out;
}

/** Whether only whitespace stands between `from` and a closing `}` or `]`. */
function closesAfterWhitespace(text: string, from: number): boolean {
  let j = from;
  while (j < text.length && /\s/u.test(text[j] as string)) j += 1;
  return text[j] === '}' || text[j] === ']';
}

// ─── MCP servers ────────────────────────────────────────────────────────────

const SERVER_KEYS = ['mcpServers', 'servers'] as const;

type Ecosystem = 'npm' | 'python' | 'docker';

interface Launcher {
  name: string;
  ecosystem: Ecosystem;
  rest: string[];
}

interface Launch {
  launcher: string;
  package: string | null;
  version: string | null;
  pinned: boolean;
  /** Why it is not pinned; `null` when it is. */
  reason: string | null;
  autoInstall: boolean;
}

/** Flags that take a value, per launcher, so the value is not mistaken for the package. */
const VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  npx: new Set(['-p', '--package', '-c', '--call', '--registry']),
  bunx: new Set(['-p', '--package']),
  'pnpm dlx': new Set(['--package']),
  uvx: new Set(['--from', '--with', '--python', '-p', '--index', '--index-url']),
  'pipx run': new Set(['--spec', '--python', '--pip-args']),
  'docker run': new Set([
    '-e',
    '--env',
    '--env-file',
    '-v',
    '--volume',
    '--mount',
    '--name',
    '--network',
    '-p',
    '--publish',
    '-w',
    '--workdir',
    '--entrypoint',
    '-u',
    '--user',
    '--platform',
    '-l',
    '--label',
    '-m',
    '--memory',
    '--cpus',
    '--add-host',
    '--cap-add',
    '--cap-drop',
    '-h',
    '--hostname',
    '--device',
    '--pull',
    '--runtime',
  ]),
};

/** Flags whose value *is* the package spec. */
const PACKAGE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  npx: new Set(['-p', '--package']),
  bunx: new Set(['-p', '--package']),
  'pnpm dlx': new Set(['--package']),
  uvx: new Set(['--from']),
  'pipx run': new Set(['--spec']),
  'docker run': new Set(),
};

function basename(command: string): string {
  const last = command.split(/[\\/]/u).pop() as string;
  return last.toLowerCase().replace(/\.(?:cmd|exe|bat|ps1)$/u, '');
}

/** Which fetch-at-launch tool runs the server, seeing through Windows' `cmd /c npx …`. */
function launcherOf(command: string, args: readonly string[]): Launcher | null {
  let base = basename(command);
  let rest = [...args];
  if (base === 'cmd' && rest[0]?.toLowerCase() === '/c') {
    const inner = rest[1];
    if (inner === undefined) return null;
    base = basename(inner);
    rest = rest.slice(2);
  }
  if (base === 'npx' || base === 'bunx') return { name: base, ecosystem: 'npm', rest };
  if (base === 'uvx') return { name: base, ecosystem: 'python', rest };
  if (base === 'pnpm' && rest[0] === 'dlx')
    return { name: 'pnpm dlx', ecosystem: 'npm', rest: rest.slice(1) };
  if (base === 'pipx' && rest[0] === 'run')
    return { name: 'pipx run', ecosystem: 'python', rest: rest.slice(1) };
  if (base === 'docker' && rest[0] === 'run')
    return { name: 'docker run', ecosystem: 'docker', rest: rest.slice(1) };
  return null;
}

/** The package spec and whether `-y`/`--yes` was passed, reading flags the launcher's way. */
function specOf(launcher: Launcher): { spec: string | null; autoInstall: boolean } {
  const valueFlags = VALUE_FLAGS[launcher.name] as ReadonlySet<string>;
  const packageFlags = PACKAGE_FLAGS[launcher.name] as ReadonlySet<string>;
  let autoInstall = false;
  let positional: string | null = null;
  let flagged: string | null = null;
  for (let i = 0; i < launcher.rest.length; i += 1) {
    const token = launcher.rest[i] as string;
    if (!token.startsWith('-')) {
      // The first positional is the package; everything after it belongs to the server.
      positional = token;
      break;
    }
    const flag = flagParts(token, launcher.rest[i + 1]);
    if (isAutoInstallFlag(launcher, token)) autoInstall = true;
    if (packageFlags.has(flag.name) && flag.value !== undefined) flagged ??= flag.value;
    if (!flag.inline && valueFlags.has(flag.name)) i += 1;
  }
  return { spec: flagged ?? positional, autoInstall };
}

/** `--name=value`, or `--name` whose value — if it takes one — is the next token. */
function flagParts(
  token: string,
  following: string | undefined,
): { name: string; value: string | undefined; inline: boolean } {
  const equals = token.indexOf('=');
  if (equals < 0) return { name: token, value: following, inline: false };
  return { name: token.slice(0, equals), value: token.slice(equals + 1), inline: true };
}

/** npx's `-y`/`--yes`, which installs a package without asking. */
function isAutoInstallFlag(launcher: Launcher, token: string): boolean {
  return launcher.name === 'npx' && (token === '-y' || token === '--yes' || token === '--yes=true');
}

function isLocalPath(spec: string): boolean {
  return /^(?:[.~/]|[A-Za-z]:[\\/]|file:)/u.test(spec);
}

/** Exact SemVer 2.0: `x.y.z` with an optional prerelease and build, and nothing else. */
function isExactSemver(version: string): boolean {
  const plus = version.indexOf('+');
  const build = plus < 0 ? null : version.slice(plus + 1);
  const head = plus < 0 ? version : version.slice(0, plus);
  const dash = head.indexOf('-');
  const core = dash < 0 ? head : head.slice(0, dash);
  const pre = dash < 0 ? null : head.slice(dash + 1);
  const identifiers = /^[0-9A-Za-z.-]+$/u;
  return (
    /^\d+\.\d+\.\d+$/u.test(core) &&
    (pre === null || identifiers.test(pre)) &&
    (build === null || identifiers.test(build))
  );
}

/** `==1.0` / `@0.6.2`: dotted digits only. A prerelease pin reads as unpinned, which errs loud. */
function isExactPythonVersion(version: string): boolean {
  return version.split('.').every((part) => /^\d+$/u.test(part));
}

function splitSpec(ecosystem: Ecosystem, spec: string): { name: string; version: string | null } {
  if (ecosystem === 'docker') {
    const digest = spec.indexOf('@');
    if (digest > 0) return { name: spec.slice(0, digest), version: spec.slice(digest + 1) };
    const colon = spec.lastIndexOf(':');
    return colon > spec.lastIndexOf('/')
      ? { name: spec.slice(0, colon), version: spec.slice(colon + 1) }
      : { name: spec, version: null };
  }
  if (ecosystem === 'python') {
    const exact = spec.indexOf('==');
    if (exact > 0) return { name: spec.slice(0, exact), version: spec.slice(exact + 2) };
    const specifier = spec.search(/[<>=!~]/u);
    if (specifier > 0) return { name: spec.slice(0, specifier), version: spec.slice(specifier) };
  }
  const at = spec.lastIndexOf('@');
  return at > 0
    ? { name: spec.slice(0, at), version: spec.slice(at + 1) }
    : { name: spec, version: null };
}

/**
 * Why a fetched version is not a pin, or `null` when it is. A Docker tag is recorded as the
 * version but is not a pin: tags are mutable and only `@sha256:` names the bytes.
 */
function unpinnedReason(ecosystem: Ecosystem, version: string | null): string | null {
  if (version === null) return 'no version';
  if (version.toLowerCase() === 'latest' || version.toLowerCase() === 'next') {
    return `the moving "${version}" tag`;
  }
  if (ecosystem === 'docker') {
    if (version.startsWith('sha256:')) {
      return /^sha256:[a-f0-9]{64}$/u.test(version) ? null : `"${version}", not an exact version`;
    }
    return `the mutable tag "${version}", not a digest`;
  }
  const exact = ecosystem === 'npm' ? isExactSemver(version) : isExactPythonVersion(version);
  return exact ? null : `"${version}", not an exact version`;
}

function launchOf(command: string, args: readonly string[]): Launch | null {
  const launcher = launcherOf(command, args);
  if (launcher === null) return null;
  const { spec, autoInstall } = specOf(launcher);
  if (spec === null) return null;
  if (launcher.ecosystem !== 'docker' && isLocalPath(spec)) {
    return {
      launcher: launcher.name,
      package: spec,
      version: null,
      pinned: true,
      reason: null,
      autoInstall: false,
    };
  }
  const { name, version } = splitSpec(launcher.ecosystem, spec);
  const reason = unpinnedReason(launcher.ecosystem, version);
  return {
    launcher: launcher.name,
    package: name,
    version,
    pinned: reason === null,
    reason,
    autoInstall,
  };
}

function transportOf(server: Json, command: string | null, url: string | null): McpTransport {
  const type = server['type'] ?? server['transport'];
  if (typeof type === 'string') {
    const lower = type.toLowerCase();
    if (lower === 'stdio') return 'stdio';
    if (lower === 'sse') return 'sse';
    if (lower === 'http' || lower === 'streamable-http' || lower === 'streamablehttp')
      return 'http';
    return 'unknown';
  }
  if (command !== null) return 'stdio';
  if (url !== null) return (url.split('?')[0] as string).endsWith('/sse') ? 'sse' : 'http';
  return 'unknown';
}

function parseUrl(url: string): URL | null {
  if (url.includes('${')) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const REDACTED = 'REDACTED';

function redactQuery(query: string): string {
  return query
    .split('&')
    .filter((part) => part !== '')
    .map((part) => `${part.split('=')[0] ?? ''}=${REDACTED}`)
    .join('&');
}

/**
 * A server URL as the inventory keeps it: no userinfo, no fragment, and every query value
 * replaced by `REDACTED` (the keys stay, so a reader can see a credential was there). The
 * same scan flags a URL credential as a finding; the inventory must not then publish it. A
 * URL the WHATWG parser refuses — a `${VAR}` template, say — is redacted by its shape.
 */
export function redactServerUrl(raw: string): string {
  const parsed = parseUrl(raw);
  if (parsed !== null) {
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    const keys = [...parsed.searchParams.keys()];
    parsed.search = keys.map((key) => `${encodeURIComponent(key)}=${REDACTED}`).join('&');
    return parsed.toString();
  }
  const [withoutFragment = ''] = raw.split('#');
  const queryAt = withoutFragment.indexOf('?');
  const base = (queryAt === -1 ? withoutFragment : withoutFragment.slice(0, queryAt)).replace(
    /^([^/?#]*\/\/)[^/?#@]*@/u,
    '$1',
  );
  return queryAt === -1 ? base : `${base}?${redactQuery(withoutFragment.slice(queryAt + 1))}`;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host)
  );
}

interface JsonContext {
  path: string;
  text: string;
  findings: Findings;
}

function checkArgs(context: JsonContext, name: string, args: readonly string[]): void {
  const { path, text, findings } = context;
  args.forEach((arg, index) => {
    for (const hit of secretsIn(arg)) {
      findings.add(
        'agent-config/mcp-secret-in-args',
        path,
        lineOf(text, arg),
        hit.value,
        `MCP server "${name}" passes a ${hit.label} in its args, where process listings and logs see it; use env.`,
      );
    }
    if (!arg.startsWith('-')) return;
    const equals = arg.indexOf('=');
    const flag = equals < 0 ? arg : arg.slice(0, equals);
    const next = args[index + 1];
    const value =
      equals < 0 ? (next?.startsWith('-') === true ? undefined : next) : arg.slice(equals + 1);
    if (!isCredentialName(flag.replace(/^-+/u, '')) || !isLiteralCredential(value)) return;
    findings.add(
      'agent-config/mcp-secret-in-args',
      path,
      lineOf(text, equals < 0 ? value : arg),
      `${flag}\u0000${value}`,
      `MCP server "${name}" passes a literal credential to ${flag} in its args; use env.`,
    );
  });
}

function checkUrl(context: JsonContext, name: string, url: string): void {
  const { path, text, findings } = context;
  const parsed = parseUrl(url);
  if (parsed === null) return;
  const line = lineOf(text, url);
  if (parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) {
    findings.add(
      'agent-config/mcp-plaintext-remote',
      path,
      line,
      `${name}\u0000${parsed.host}`,
      `MCP server "${name}" is reached over plain http:// at ${parsed.host}; tool calls and tokens cross the network unencrypted.`,
    );
  }
  for (const [key, value] of parsed.searchParams) {
    if (!isCredentialName(key) || !isLiteralCredential(value)) continue;
    findings.add(
      'agent-config/mcp-secret-in-args',
      path,
      line,
      `${key}\u0000${value}`,
      `MCP server "${name}" passes a credential in the URL query parameter "${key}"; use a header from env.`,
    );
  }
  for (const hit of secretsIn(url)) {
    findings.add(
      'agent-config/mcp-secret-in-args',
      path,
      line,
      hit.value,
      `MCP server "${name}" carries a ${hit.label} in its URL.`,
    );
  }
}

function checkEnv(context: JsonContext, name: string, env: Json): void {
  const { path, text, findings } = context;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    const hits = secretsIn(value);
    for (const hit of hits) {
      findings.add(
        'agent-config/embedded-secret',
        path,
        lineOf(text, value),
        hit.value,
        `MCP server "${name}" has a ${hit.label} written into env ${key}; reference it (\${env:${key}}) instead.`,
      );
    }
    if (hits.length > 0 || !isCredentialName(key) || !isLiteralCredential(value)) continue;
    findings.add(
      'agent-config/embedded-secret',
      path,
      lineOf(text, value),
      value,
      `MCP server "${name}" has a literal value for the credential-named env ${key}; reference it instead.`,
    );
  }
}

function checkServerPermissions(
  context: JsonContext,
  name: string,
  server: Json,
  line: number | null,
): void {
  const { path, findings } = context;
  if (strings(server['autoApprove']).includes('*')) {
    findings.add(
      'agent-config/over-broad-permission',
      path,
      line,
      `${name}\u0000autoApprove`,
      `MCP server "${name}" sets autoApprove ["*"], so every tool it offers runs without a prompt.`,
      KIRO_MCP_CONFIGURATION,
    );
  }
  if (strings(server['alwaysAllow']).includes('*')) {
    findings.add(
      'agent-config/over-broad-permission',
      path,
      line,
      `${name}\u0000alwaysAllow`,
      `MCP server "${name}" sets alwaysAllow ["*"], so every tool it offers runs without a prompt.`,
    );
  }
  if (server['trust'] === true) {
    findings.add(
      'agent-config/over-broad-permission',
      path,
      line,
      `${name}\u0000trust`,
      `MCP server "${name}" sets trust: true, which bypasses every tool-call confirmation.`,
    );
  }
}

function serverEntry(
  context: JsonContext,
  name: string,
  server: Json,
  from: number,
): McpServerEntry {
  const { path, text, findings } = context;
  const command = typeof server['command'] === 'string' ? server['command'] : null;
  const args = strings(server['args']);
  const rawUrl = server['url'] ?? server['serverUrl'];
  const url = typeof rawUrl === 'string' ? rawUrl : null;
  const env = record(server['env']);
  const line = lineOf(text, JSON.stringify(name), from);
  const launch = command === null ? null : launchOf(command, args);

  if (launch?.reason != null) {
    findings.add(
      'agent-config/mcp-unpinned',
      path,
      line,
      `${name}\u0000${String(launch.package)}`,
      `MCP server "${name}" fetches ${String(launch.package)} via ${launch.launcher} with ${launch.reason}; pin an exact version or digest so the code it runs cannot change under it.`,
    );
  }
  if (launch?.autoInstall === true) {
    findings.add(
      'agent-config/mcp-auto-install',
      path,
      line,
      name,
      `MCP server "${name}" runs npx with -y/--yes, which installs the package without asking.`,
    );
  }
  checkArgs(context, name, args);
  if (url !== null) checkUrl(context, name, url);
  if (env !== null) checkEnv(context, name, env);
  checkServerPermissions(context, name, server, line);

  return {
    name,
    configPath: path,
    transport: transportOf(server, command, url),
    command,
    package: launch?.package ?? null,
    version: launch?.version ?? null,
    pinned: launch?.pinned ?? true,
    url: url === null ? null : redactServerUrl(url),
    envKeys: env === null ? [] : Object.keys(env),
  };
}

// ─── Settings and the generic walk ──────────────────────────────────────────

/** CLI flags that turn approvals off: Claude Code, Gemini CLI, Codex CLI. */
const SKIP_APPROVAL_FLAGS = [
  '--dangerously-skip-permissions',
  '--yolo',
  '--dangerously-bypass-approvals-and-sandbox',
] as const;

const BROAD_ALLOW = new Set(['bash', 'bash(*)', '*']);

function checkClaudeSettings(context: JsonContext, root: Json): void {
  const { path, text, findings } = context;
  const permissions = record(root['permissions']);
  if (permissions !== null) {
    for (const entry of strings(permissions['allow'])) {
      if (!BROAD_ALLOW.has(entry.trim().toLowerCase())) continue;
      findings.add(
        'agent-config/over-broad-permission',
        path,
        lineOf(text, JSON.stringify(entry)),
        `allow\u0000${entry}`,
        `permissions.allow grants "${entry}", so any shell command or tool runs without a prompt.`,
      );
    }
    if (permissions['defaultMode'] === 'bypassPermissions') {
      findings.add(
        'agent-config/over-broad-permission',
        path,
        lineOf(text, '"defaultMode"'),
        'defaultMode\u0000bypassPermissions',
        'permissions.defaultMode is bypassPermissions, so no tool call asks for approval.',
      );
    }
  }
  if (root['enableAllProjectMcpServers'] === true) {
    findings.add(
      'agent-config/over-broad-permission',
      path,
      lineOf(text, '"enableAllProjectMcpServers"'),
      'enableAllProjectMcpServers',
      'enableAllProjectMcpServers is true, so every MCP server a commit adds to .mcp.json is approved without review.',
    );
  }
}

/** Strings the MCP pass already judged, so the generic walk does not report them twice. */
function handledByServerPass(trail: readonly string[]): boolean {
  return (
    trail.length >= 3 &&
    (SERVER_KEYS as readonly string[]).includes(trail[0] as string) &&
    ['args', 'env', 'url', 'serverUrl'].includes(trail[2] as string)
  );
}

function walkStrings(context: JsonContext, value: unknown, trail: string[]): void {
  if (typeof value === 'string') {
    if (handledByServerPass(trail)) return;
    checkString(context, value, trail.join('.'));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(context, item, [...trail, String(index)]));
    return;
  }
  const object = record(value);
  if (object === null) return;
  for (const [key, child] of Object.entries(object)) walkStrings(context, child, [...trail, key]);
}

function checkString(context: JsonContext, value: string, at: string): void {
  const { path, text, findings } = context;
  for (const hit of secretsIn(value)) {
    findings.add(
      'agent-config/embedded-secret',
      path,
      lineOf(text, value),
      hit.value,
      `${hit.label} written into agent configuration at ${at}; reference it from the environment.`,
    );
  }
  const tokens = value.split(/\s+/u);
  for (const flag of SKIP_APPROVAL_FLAGS) {
    if (!tokens.includes(flag)) continue;
    findings.add(
      'agent-config/over-broad-permission',
      path,
      lineOf(text, value),
      `flag\u0000${flag}\u0000${at}`,
      `${at} runs an agent with ${flag}, which disables every approval prompt.`,
    );
  }
}

function scanJson(path: string, raw: string, findings: Findings, servers: McpServerEntry[]): void {
  checkInvisible(raw.split(/\r?\n/u), path, findings);
  const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(text));
  } catch {
    findings.add(
      'agent-config/unparseable',
      path,
      null,
      'unparseable',
      `${path} does not parse as JSON or JSONC, so its MCP servers and permissions were not checked.`,
    );
    return;
  }
  const root = record(parsed);
  if (root === null) return;
  const context: JsonContext = { path, text, findings };
  for (const key of SERVER_KEYS) {
    const map = record(root[key]);
    if (map === null) continue;
    const from = Math.max(0, text.indexOf(JSON.stringify(key)));
    for (const [name, value] of Object.entries(map)) {
      const server = record(value);
      if (server !== null) servers.push(serverEntry(context, name, server, from));
    }
  }
  checkClaudeSettings(context, root);
  walkStrings(context, root, []);
}

/**
 * Scan agent instruction and MCP config files. Files whose path is not an agent config
 * (`isAgentConfigPath`) are ignored and not counted, so a caller may pass a whole tree.
 */
export function scanAgentConfig(files: readonly AgentConfigFile[]): AgentConfigScan {
  const findings = new Findings();
  const mcpServers: McpServerEntry[] = [];
  let filesScanned = 0;
  for (const file of files) {
    if (!isAgentConfigPath(file.path)) continue;
    filesScanned += 1;
    const path = normalisePath(file.path);
    if (/\.jsonc?$/iu.test(path)) scanJson(path, file.text, findings, mcpServers);
    else scanProse(path, file.text, findings);
  }
  return { findings: findings.list(), mcpServers, filesScanned };
}
