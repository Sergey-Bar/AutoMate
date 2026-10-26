/**
 * SPDX licence expressions, read and judged against an allow/deny policy.
 *
 * ## Why this is a parser and not a string comparison
 *
 * An SBOM's `licenseDeclared` is an expression, not a name. `MIT OR GPL-3.0` is a package
 * the consumer may take under MIT, and comparing the whole string to a deny list either
 * blocks it (a substring match on `GPL`) or waves through `MIT AND GPL-3.0` (an exact
 * match that never hits). Both mistakes are common in licence gates, and both come from
 * not reading the grammar. So the grammar is read: ids, the `+` suffix, `LicenseRef-`
 * and `DocumentRef-…:LicenseRef-` references, `WITH`, `AND`, `OR` and parentheses, with
 * WITH binding tighter than AND and AND tighter than OR, exactly as SPDX 2.3 Annex D sets
 * out.
 *
 * ## Absence is not permission
 *
 * `NOASSERTION`, `NONE`, an empty field and a missing one are all reported as `unknown`.
 * `NONE` in particular means "no licence was granted", which is the opposite of
 * permissive, and a gate that read it as "nothing to object to" would allow exactly the
 * packages nobody may legally ship.
 */

export type LicenceExpression =
  | {
      kind: 'licence';
      /** The id as written: matching is case-insensitive, display keeps the author's casing. */
      id: string;
      /** The `+` suffix: this version or any later one. */
      orLater: boolean;
      exception: string | null;
    }
  | { kind: 'and'; left: LicenceExpression; right: LicenceExpression }
  | { kind: 'or'; left: LicenceExpression; right: LicenceExpression };

export type ParsedLicence =
  { status: 'parsed'; expression: LicenceExpression } | { status: 'unknown'; reason: string };

/** A malformed expression, with the character offset at which reading stopped. */
export class LicenceExpressionError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = 'LicenceExpressionError';
  }
}

interface Token {
  text: string;
  offset: number;
}

function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/\(|\)|[^\s()]+/gu)) {
    tokens.push({ text: match[0], offset: match.index });
  }
  return tokens;
}

const ID = /^[A-Za-z0-9.-]+$/u;
const REFERENCE_PREFIX = /^(?:DocumentRef|LicenseRef)-/iu;
const SENTINELS = new Set(['noassertion', 'none']);

/** `prefix` followed by an idstring, compared without regard to case. */
function prefixed(word: string, prefix: string): boolean {
  return (
    word.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase() &&
    ID.test(word.slice(prefix.length))
  );
}

/**
 * `LicenseRef-x` or `DocumentRef-y:LicenseRef-x`.
 *
 * Read with string operations rather than one pattern: the pattern is an optional group
 * holding a quantifier, the shape `security/detect-unsafe-regex` refuses.
 */
function isReference(word: string): boolean {
  const colon = word.indexOf(':');
  if (colon === -1) return prefixed(word, 'LicenseRef-');
  return (
    prefixed(word.slice(0, colon), 'DocumentRef-') && prefixed(word.slice(colon + 1), 'LicenseRef-')
  );
}

function operator(token: Token | undefined): 'and' | 'or' | 'with' | null {
  const word = token?.text.toLowerCase();
  return word === 'and' || word === 'or' || word === 'with' ? word : null;
}

/** A recursive-descent reader over the token list; one instance per call. */
class Reader {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly end: number,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private offset(): number {
    return this.peek()?.offset ?? this.end;
  }

  private fail(message: string): never {
    throw new LicenceExpressionError(message, this.offset());
  }

  read(): LicenceExpression {
    const expression = this.or();
    const rest = this.peek();
    if (rest !== undefined) this.fail(`unexpected '${rest.text}'`);
    return expression;
  }

  private or(): LicenceExpression {
    let left = this.and();
    while (operator(this.peek()) === 'or') {
      this.index += 1;
      left = { kind: 'or', left, right: this.and() };
    }
    return left;
  }

  private and(): LicenceExpression {
    let left = this.with();
    while (operator(this.peek()) === 'and') {
      this.index += 1;
      left = { kind: 'and', left, right: this.with() };
    }
    return left;
  }

  private with(): LicenceExpression {
    const token = this.peek();
    if (token?.text === '(') {
      this.index += 1;
      const inner = this.or();
      if (this.peek()?.text !== ')') this.fail("expected ')'");
      this.index += 1;
      this.refuseWith();
      return inner;
    }
    const leaf = this.licence();
    if (operator(this.peek()) === 'with') {
      this.index += 1;
      leaf.exception = this.exception();
      this.refuseWith();
    }
    return leaf;
  }

  /** WITH qualifies one licence id; anything else in front of it is a grammar error. */
  private refuseWith(): void {
    if (operator(this.peek()) === 'with') this.fail('WITH applies to a single licence id');
  }

  private licence(): LicenceExpression & { kind: 'licence' } {
    const token = this.peek();
    if (token === undefined || token.text === '(' || token.text === ')' || operator(token)) {
      this.fail('expected a licence id');
    }
    if (SENTINELS.has(token.text.toLowerCase())) {
      this.fail(`${token.text.toUpperCase()} cannot be combined with other licences`);
    }
    this.index += 1;
    if (isReference(token.text)) {
      return { kind: 'licence', id: token.text, orLater: false, exception: null };
    }
    const orLater = token.text.endsWith('+');
    const id = orLater ? token.text.slice(0, -1) : token.text;
    // A reference is a whole licence text, so "or later" has no version to be later than.
    if (!ID.test(id) || (orLater && REFERENCE_PREFIX.test(id))) {
      throw new LicenceExpressionError(`invalid licence id '${token.text}'`, token.offset);
    }
    return { kind: 'licence', id, orLater, exception: null };
  }

  private exception(): string {
    const token = this.peek();
    if (token === undefined || token.text === '(' || token.text === ')' || operator(token)) {
      this.fail('expected an exception id after WITH');
    }
    if (!ID.test(token.text)) {
      this.fail(`invalid exception id '${token.text}'`);
    }
    this.index += 1;
    return token.text;
  }
}

/**
 * Reads an SPDX licence expression.
 *
 * The undeclared forms — `null`, blank, `NOASSERTION`, `NONE` — come back as `unknown`
 * rather than as an error, because they are well-formed statements that nothing was
 * declared and a caller has to be able to tell that from a typo. A typo throws
 * `LicenceExpressionError`. `NOASSERTION` inside a compound expression throws too: SPDX
 * defines the two sentinels as whole-field values, and `MIT OR NONE` has no meaning a
 * gate could honestly assign.
 *
 * Operators are accepted in any case, which is looser than SPDX's "all upper or all lower"
 * and costs nothing: no licence id is spelled `And`.
 */
export function parseLicenceExpression(text: string | null | undefined): ParsedLicence {
  if (text === null || text === undefined || text.trim() === '') {
    return { status: 'unknown', reason: 'No licence is declared' };
  }
  const trimmed = text.trim();
  if (SENTINELS.has(trimmed.toLowerCase())) {
    return { status: 'unknown', reason: `The licence is declared as ${trimmed.toUpperCase()}` };
  }
  return { status: 'parsed', expression: new Reader(tokenise(text), text.length).read() };
}

function leafText(leaf: LicenceExpression & { kind: 'licence' }): string {
  const base = `${leaf.id}${leaf.orLater ? '+' : ''}`;
  return leaf.exception === null ? base : `${base} WITH ${leaf.exception}`;
}

/**
 * Writes an expression back as SPDX text, parenthesising every compound operand.
 *
 * Fully parenthesised rather than minimal, because the output is read by people checking a
 * verdict, and `(A OR B) AND C` cannot be misread whereas relying on precedence can.
 */
export function formatLicenceExpression(expression: LicenceExpression): string {
  if (expression.kind === 'licence') return leafText(expression);
  const operand = (child: LicenceExpression) =>
    child.kind === 'licence' ? leafText(child) : `(${formatLicenceExpression(child)})`;
  const word = expression.kind === 'and' ? 'AND' : 'OR';
  return `${operand(expression.left)} ${word} ${operand(expression.right)}`;
}

// ─── evaluation ──────────────────────────────────────────────────────────────

export interface LicencePolicy {
  /** When present — even empty — only these licences are allowed. */
  allow?: readonly string[];
  deny?: readonly string[];
}

export type LicenceVerdict = 'allowed' | 'denied' | 'unknown' | 'unlisted';

export interface LicenceEvaluation {
  verdict: LicenceVerdict;
  reason: string;
  /** The licences of the least restricted way to satisfy the expression; `null` when unknown. */
  chosen: string[] | null;
}

type LeafStatus = 'allowed' | 'unlisted' | 'denied';
const RANK: Record<LeafStatus, number> = { allowed: 0, unlisted: 1, denied: 2 };

interface Choice {
  status: LeafStatus;
  picks: { text: string; status: LeafStatus }[];
}

function normalise(entry: string): string {
  return entry.trim().replace(/\s+/gu, ' ').toLowerCase();
}

/** The names a leaf answers to, most specific first. */
function baseNames(leaf: LicenceExpression & { kind: 'licence' }): string[] {
  const id = leaf.id.toLowerCase();
  return leaf.orLater ? [`${id}+`, `${id}-or-later`, id] : [id];
}

function classifyLeaf(
  leaf: LicenceExpression & { kind: 'licence' },
  allow: ReadonlySet<string> | null,
  deny: ReadonlySet<string>,
): LeafStatus {
  const bases = baseNames(leaf);
  const exception = leaf.exception?.toLowerCase();
  if (exception !== undefined) {
    // An entry naming the exception is more specific than one naming the licence alone,
    // so `GPL-2.0 WITH Classpath-exception-2.0` can be allowed while `GPL-2.0` is denied.
    const full = bases.map((base) => `${base} with ${exception}`);
    if (full.some((name) => deny.has(name))) return 'denied';
    if (allow !== null && full.some((name) => allow.has(name))) return 'allowed';
  }
  if (bases.some((name) => deny.has(name))) return 'denied';
  if (allow === null || bases.some((name) => allow.has(name))) return 'allowed';
  return 'unlisted';
}

function choose(
  expression: LicenceExpression,
  allow: ReadonlySet<string> | null,
  deny: ReadonlySet<string>,
): Choice {
  if (expression.kind === 'licence') {
    const status = classifyLeaf(expression, allow, deny);
    return { status, picks: [{ text: leafText(expression), status }] };
  }
  const left = choose(expression.left, allow, deny);
  const right = choose(expression.right, allow, deny);
  if (expression.kind === 'or') return RANK[right.status] < RANK[left.status] ? right : left;
  const status = RANK[right.status] > RANK[left.status] ? right.status : left.status;
  return { status, picks: [...left.picks, ...right.picks] };
}

function named(choice: Choice, status: LeafStatus): string {
  return choice.picks
    .filter((pick) => pick.status === status)
    .map((pick) => pick.text)
    .join(', ');
}

/**
 * Judges a declared licence expression against a policy.
 *
 * Each `OR` is a choice the consumer gets to make and each `AND` is an obligation, so the
 * verdict is that of the **least restricted** way of satisfying the expression: a leaf is
 * allowed, unlisted or denied, an OR takes its better branch and an AND its worse operand.
 * That one ordering gives every rule the gate needs — `denied` only when every way out
 * uses a denied licence, `allowed` when some way uses allowed licences only, `unlisted`
 * between — in time linear in the expression, where enumerating every combination of
 * choices would be exponential in the number of ORs.
 *
 * Deny wins over allow for the same name, an entry naming `X WITH Y` beats one naming `X`,
 * and an `X+` leaf answers to `X+`, `X-or-later` and `X`: taking `X` is one of the choices
 * `+` grants, so allowing `X` allows it, and denying `X` is read as the conservative
 * intent to deny the family. With only a deny list everything not denied is allowed; an
 * allow list that is present but empty allows nothing.
 */
export function evaluateLicence(
  expression: string | null,
  policy: LicencePolicy,
): LicenceEvaluation {
  let parsed: ParsedLicence;
  try {
    parsed = parseLicenceExpression(expression);
  } catch (error) {
    // The reader throws nothing but LicenceExpressionError.
    const message = (error as LicenceExpressionError).message;
    return {
      verdict: 'unknown',
      reason: `The licence expression cannot be read (${message}), so it cannot be allowed.`,
      chosen: null,
    };
  }
  if (parsed.status === 'unknown') {
    return {
      verdict: 'unknown',
      reason: `${parsed.reason}, so it cannot be allowed.`,
      chosen: null,
    };
  }
  const allow = policy.allow === undefined ? null : new Set(policy.allow.map(normalise));
  const deny = new Set((policy.deny ?? []).map(normalise));
  const best = choose(parsed.expression, allow, deny);
  const chosen = best.picks.map((pick) => pick.text);
  const joined = chosen.join(' AND ');
  switch (best.status) {
    case 'allowed':
      return {
        verdict: 'allowed',
        reason: `Satisfiable as ${joined}, which the policy allows.`,
        chosen,
      };
    case 'denied':
      return {
        verdict: 'denied',
        reason: `Every way to satisfy the expression uses a denied licence; the least restricted still needs ${named(best, 'denied')}.`,
        chosen,
      };
    case 'unlisted':
      return {
        verdict: 'unlisted',
        reason: `No way to satisfy the expression uses allowed licences only; the closest needs ${named(best, 'unlisted')}, which the allow list does not name.`,
        chosen,
      };
  }
}
