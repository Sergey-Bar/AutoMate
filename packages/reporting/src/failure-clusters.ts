/**
 * Failure clustering: which failures share a root cause.
 *
 * ## Why a signature and not the message
 *
 * The same broken database connection fails forty tests with forty different messages —
 * each carries its own port, timestamp, request id and temp directory. Grouping by the raw
 * message reports forty problems; grouping by test reports forty more. A **signature** is
 * the message with everything that varies between occurrences of one cause taken out, plus
 * the first two frames of the caller's own code, so one cause is one row and a reviewer
 * fixes the row with the biggest count first.
 *
 * ## What is kept, and why
 *
 * Normalising too little splits a cause; normalising too much merges two. So the error
 * type is kept, words are kept, and the two identifiers V8 puts in quotes because they
 * *are* the cause — the property in `(reading 'id')` and the module in
 * `Cannot find module 'x'` — are kept. A `TypeError` reading `id` and one reading `name`
 * come from different lines of code with different fixes, and merging them would hide the
 * second behind the first. Every other quoted string is data and is emptied.
 */

export interface FailureSignature {
  signature: string;
  errorType: string | null;
}

export interface FailureInput {
  runId: string;
  testKey: string;
  branch: string | null;
  /** ISO-8601 UTC, so that string order is time order. */
  at: string;
  message: string;
  stack?: string | null;
}

export interface FailureCluster {
  signature: string;
  errorType: string | null;
  /** The earliest message in the cluster, verbatim, for a reader who wants the real text. */
  sampleMessage: string;
  count: number;
  tests: string[];
  branches: string[];
  /** Distinct runs the cause appeared in. */
  runs: number;
  firstSeen: string;
  lastSeen: string;
}

export interface FailureClusters {
  clusters: FailureCluster[];
  totals: { failures: number; causes: number };
}

const MAX_MESSAGE = 400;
const MAX_FRAME = 80;
const FRAMES_KEPT = 2;
/**
 * The bounds on what is normalised at all. Failure messages and stacks are uploaded text with
 * no cap of their own, and clustering runs on every insights read: the signature keeps 400
 * characters, so reading the first 4 KB of a message (and 16 KB of a stack) loses nothing.
 */
const MAX_NORMALISED_MESSAGE = 4096;
const MAX_READ_STACK = 16_384;
/** How far back from a quote `MEANINGFUL_QUOTE` looks: the longest keyword and some space. */
const QUOTE_CONTEXT = 32;

/** Quotes whose content names the cause rather than carrying data. */
const MEANINGFUL_QUOTE = /(?:reading|setting|module|package)\s*$/iu;

// Several of the steps below are readers rather than single patterns. Each of those
// patterns nests a quantifier inside an optional or repeated group — the shape
// `security/detect-unsafe-regex` refuses — and this module runs on failure messages,
// which are text the product did not write.

const DATE = /\b\d{4}-\d{2}-\d{2}/gu;
const TIME_TAIL = [/[T ]\d{2}:\d{2}/uy, /:\d{2}/uy, /\.\d+/uy, /Z|[+-]\d{2}:?\d{2}/uy] as const;

/** Where `pattern` stops matching when anchored at `at`; `at` when it does not match. */
function sticky(pattern: RegExp, text: string, at: number): number {
  pattern.lastIndex = at;
  return pattern.test(text) ? pattern.lastIndex : at;
}

/** ISO-8601 dates and date-times, with or without seconds, fraction and zone. */
function timestamps(text: string): string {
  let out = '';
  let from = 0;
  for (const match of text.matchAll(DATE)) {
    const dateEnd = match.index + match[0].length;
    let end = sticky(TIME_TAIL[0], text, dateEnd);
    if (end !== dateEnd) {
      for (const pattern of TIME_TAIL.slice(1)) end = sticky(pattern, text, end);
    }
    out += `${text.slice(from, match.index)}<time>`;
    from = end;
  }
  return out + text.slice(from);
}

const EXTENSION = /\.[A-Za-z]\w{0,5}$/u;
const DIGITS = /^\d+$/u;

/** A relative path with a separator and an extension, and an optional `:line[:col]`. */
function barePath(token: string): string {
  const core = token.replace(/\.+$/u, '');
  const trailing = token.slice(core.length);
  const [path, ...position] = core.split(':');
  if (position.length > 2 || !position.every((part) => DIGITS.test(part))) return token;
  const file = path as string;
  if (!/[\\/]/u.test(file) || !EXTENSION.test(file)) return token;
  return `<path>${trailing}`;
}

/**
 * One quoted run: kept when the words just before it make it meaningful, masked otherwise.
 *
 * A named replacer rather than an inline arrow, reading the subject from `String.replace`'s
 * own trailing argument. Inline, its four parameters were the shape semgrep's
 * `express-error-handler-swallowed` reads as an `(err, req, res, next)` handler.
 */
function maskQuote(
  whole: string,
  quote: string,
  _content: string,
  offset: number,
  subject: string,
): string {
  // Only the words just before the quote decide: testing the whole prefix per quote
  // was quadratic in a message of many quotes.
  return MEANINGFUL_QUOTE.test(subject.slice(Math.max(0, offset - QUOTE_CONTEXT), offset))
    ? whole
    : `${quote}<str>${quote}`;
}

const PATH_CHARS = String.raw`[^\s'"\x60()<>]`;
const VOLATILE: readonly ((text: string) => string)[] = [
  timestamps,
  (text) =>
    text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, '<uuid>'),
  (text) =>
    text.replace(new RegExp(String.raw`\b[a-z][a-z0-9+.-]*://${PATH_CHARS}+`, 'giu'), '<url>'),
  (text) => text.replace(/(?<!\w)(['"`])((?:(?!\1)[^\n])*)\1/gu, maskQuote),
  // Windows absolute, Unix absolute, ./ and ../ relative, then bare relative with an
  // extension — each swallowing a trailing :line:col.
  (text) => text.replace(new RegExp(String.raw`\b[A-Za-z]:[\\/]${PATH_CHARS}*`, 'gu'), '<path>'),
  (text) => text.replace(new RegExp(String.raw`(?<![\w.<>/:@-])/${PATH_CHARS}+`, 'gu'), '<path>'),
  (text) =>
    text.replace(new RegExp(String.raw`(?<![\w./])\.{1,2}[\\/]${PATH_CHARS}+`, 'gu'), '<path>'),
  (text) => text.replace(/(?<![\w./<>-])[\w@-][\w@.\\/:-]*/gu, barePath),
  (text) => text.replace(/\b0x[0-9a-f]+\b/giu, '<hex>'),
  // At least one digit and one letter, so `facade` and `added` stay words and a long
  // plain number stays a number.
  (text) => text.replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,}\b/giu, '<hex>'),
  // Dotted runs are one number, so 3.14, a version and an IPv4 address each become `<n>`;
  // a sentence's full stop after a number is left alone.
  (text) =>
    text.replace(/\d[\d.]*/gu, (run) => {
      const number = run.replace(/\.+$/u, '');
      return `<n>${run.slice(number.length)}`;
    }),
];

function normaliseMessage(message: string): string {
  let text = message.slice(0, MAX_NORMALISED_MESSAGE);
  for (const step of VOLATILE) text = step(text);
  return text.replace(/\s+/gu, ' ').trim().toLowerCase().slice(0, MAX_MESSAGE);
}

/** `TypeError`, `AssertionError`, `java.lang.IllegalStateException` — the first word. */
function errorTypeOf(text: string | null | undefined): string | null {
  const first = (text ?? '').trim().split('\n')[0] as string;
  const end = first.search(/[\s:[(]/u);
  const word = end === -1 ? first : first.slice(0, end);
  const named = /^[\w$][\w$.]*$/u.test(word) && /(?:Error|Exception)$/u.test(word);
  return named ? word : null;
}

/** `at [async] [new] name (location)`; `null` for an anonymous frame or another line. */
function v8Frame(line: string): { name: string; location: string } | null {
  let rest = line.trim();
  if (!rest.startsWith('at ')) return null;
  rest = rest.slice(3).trimStart();
  for (const prefix of ['async ', 'new ']) {
    if (rest.startsWith(prefix)) rest = rest.slice(prefix.length).trimStart();
  }
  const open = rest.indexOf(' (');
  if (open === -1 || !rest.endsWith(')')) return null;
  return { name: rest.slice(0, open).trim(), location: rest.slice(open + 2, -1) };
}

const GECKO_FRAME = /^\s*([^@\s]*)@(.+:\d+:\d+)\s*$/u;

function geckoFrame(line: string): { name: string; location: string } | null {
  const match = GECKO_FRAME.exec(line);
  return match === null ? null : { name: match[1] as string, location: match[2] as string };
}

/** The function name of a frame worth keeping, or `null` for one that is not. */
function frameName(line: string): string | null {
  const frame = v8Frame(line) ?? geckoFrame(line);
  if (frame === null) return null;
  const name = frame.name.replace(/\s*\[as [^\]]*\]$/u, '');
  const { location } = frame;
  if (name === '' || name.includes('<anonymous>')) return null;
  if (location.includes('node_modules')) return null;
  if (location.startsWith('node:') || location.startsWith('internal/')) return null;
  return name.toLowerCase().slice(0, MAX_FRAME);
}

/**
 * The root-cause key of one failure.
 *
 * The message is normalised — ISO timestamps, UUIDs, URLs, quoted data, file paths with
 * their `:line:col`, `0x` literals, hex runs of six or more, and numbers (which takes
 * ports and addresses with them) are replaced by placeholders, whitespace collapsed,
 * lower-cased, and capped so one assertion diff cannot become an enormous key. Then the
 * names of the first two stack frames that are the project's own code are appended: frames
 * in `node_modules`, `node:` and `internal/` are the same in every failure that passes
 * through a dependency, and anonymous frames have no name to compare.
 *
 * The frames' *locations* are deliberately not in the key: a line number moves when
 * anyone edits the file above it, and that is not a new cause.
 */
export function failureSignature(message: string, stack?: string | null): FailureSignature {
  const read = (stack ?? '').slice(0, MAX_READ_STACK);
  const fromMessage = errorTypeOf(message.slice(0, MAX_NORMALISED_MESSAGE));
  const errorType = fromMessage ?? errorTypeOf(read);
  let text = normaliseMessage(message);
  if (fromMessage === null && errorType !== null) text = `${errorType.toLowerCase()}: ${text}`;
  const frames: string[] = [];
  for (const line of read.split('\n')) {
    if (frames.length === FRAMES_KEPT) break;
    const name = frameName(line);
    if (name !== null) frames.push(name);
  }
  const signature = frames.length === 0 ? text : `${text} @ ${frames.join(' < ')}`;
  return { signature, errorType };
}

interface Bucket {
  first: FailureInput;
  errorType: string | null;
  count: number;
  tests: Set<string>;
  branches: Set<string>;
  runs: Set<string>;
  firstSeen: string;
  lastSeen: string;
}

/** For keys that are unique within one sort (set members, map keys), so ties never arise. */
const byText = (left: string, right: string) => (left < right ? -1 : 1);

/** Earlier first; at the same instant, the smaller message, so input order cannot decide. */
function earlier(left: FailureInput, right: FailureInput): boolean {
  return left.at < right.at || (left.at === right.at && left.message < right.message);
}

/**
 * Groups failures by `failureSignature` and ranks the causes.
 *
 * Sorted by count, then by signature, so equal counts come out in the same order on every
 * run and two reports of one window can be diffed. `maxClusters` truncates the list but
 * not the totals: `totals.causes` above `clusters.length` is how a reader learns there are
 * more. Every field is independent of the order failures are passed in.
 */
export function clusterFailures(
  failures: readonly FailureInput[],
  options: { maxClusters?: number } = {},
): FailureClusters {
  const buckets = new Map<string, Bucket>();
  for (const failure of failures) {
    const { signature, errorType } = failureSignature(failure.message, failure.stack);
    let bucket = buckets.get(signature);
    if (bucket === undefined) {
      bucket = {
        first: failure,
        errorType,
        count: 0,
        tests: new Set(),
        branches: new Set(),
        runs: new Set(),
        firstSeen: failure.at,
        lastSeen: failure.at,
      };
      buckets.set(signature, bucket);
    }
    if (earlier(failure, bucket.first)) {
      bucket.first = failure;
      bucket.errorType = errorType;
    }
    bucket.count += 1;
    bucket.tests.add(failure.testKey);
    if (failure.branch !== null) bucket.branches.add(failure.branch);
    bucket.runs.add(failure.runId);
    if (failure.at < bucket.firstSeen) bucket.firstSeen = failure.at;
    if (failure.at > bucket.lastSeen) bucket.lastSeen = failure.at;
  }
  const clusters: FailureCluster[] = [...buckets]
    .map(([signature, bucket]) => ({
      signature,
      errorType: bucket.errorType,
      sampleMessage: bucket.first.message,
      count: bucket.count,
      tests: [...bucket.tests].sort(byText),
      branches: [...bucket.branches].sort(byText),
      runs: bucket.runs.size,
      firstSeen: bucket.firstSeen,
      lastSeen: bucket.lastSeen,
    }))
    .sort((left, right) => right.count - left.count || byText(left.signature, right.signature));
  const limit = Math.max(0, options.maxClusters ?? clusters.length);
  return {
    clusters: clusters.slice(0, limit),
    totals: { failures: failures.length, causes: clusters.length },
  };
}
