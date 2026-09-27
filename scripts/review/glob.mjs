/**
 * glob.mjs — git-style globs as regular expressions.
 *
 * Two consumers need this and neither may have its own: the review ruleset, whose
 * `pathGlobs` decide where a rule applies, and the format-glob gate, which compares
 * the `format` scripts' patterns against the tracked file list. Two implementations
 * would be two answers to "does this glob match this path", and the disagreement would
 * show up as a rule that fires in CI and not in review, or the reverse.
 *
 * The forms supported are the ones actually in use, and **anything else throws** rather
 * than guessing. That is the property that makes the result trustworthy: a glob
 * translator that silently mis-reads `**\/` reports confidently about a set it never
 * computed, and the failure looks like a rule that does not fire.
 *
 * Supported:
 *   `**\/`      zero or more directories — `**\/*.ts` matches `a.ts` and `apps/api/a.ts`
 *   `**`        any characters including `/`
 *   `*`         any characters except `/`
 *   `?`         one character except `/`
 *   `{a,b}`     alternatives
 *   a bare `x/` "this path and everything under it", which is how prettier reads it
 */

/**
 * @param {string} glob
 * @returns {RegExp}
 */
/**
 * @param {string} glob
 * @returns {RegExp}
 */
/**
 * A bare directory entry, matched as "this path and everything under it".
 *
 * `node_modules/`, `packages/db/drizzle/meta/`. Matched literally it would only ever
 * match a file whose name *is* the directory, so the exclusion would silently do nothing
 * — and an exclusion that does nothing is worse than none, because the file it was
 * written to protect is then covered anyway.
 *
 * @param {string} glob
 * @returns {RegExp | null}
 */
function bareDirectoryPattern(glob) {
  if (!glob.endsWith('/') || glob.includes('*') || glob.includes('?')) return null;
  const prefix = glob.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${prefix}(/.*)?$`);
}

/**
 * A `{a,b}` alternative list, as regex source.
 *
 * Rejects an unterminated brace and an empty alternative rather than emitting a
 * pattern that matches the empty string — an empty alternative in `{a,}` would make the
 * rule apply to files named `a`, and to a file with no name at all.
 *
 * @param {string} glob
 * @param {number} open the index of the `{`
 * @returns {{ source: string, consume: number }}
 */
function braceAlternatives(glob, open) {
  const close = glob.indexOf('}', open);
  if (close === -1) throw new Error(`unterminated brace in glob: ${glob}`);
  const alternatives = glob
    .slice(open + 1, close)
    .split(',')
    .map((alternative) => alternative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (alternatives.some((alternative) => alternative === '')) {
    throw new Error(`empty alternative in brace list in glob: ${glob}`);
  }
  return { source: `(?:${alternatives.join('|')})`, consume: close - open + 1 };
}

/**
 * @param {string} glob
 * @returns {RegExp}
 */
/**
 * One token of a glob, and the regex source it contributes.
 *
 * `consume` is how many characters the token ate, so the caller advances rather than
 * the token mutating an index — which is how the earlier version of this loop ended up
 * with a `continue` after every branch and a cognitive complexity of 21.
 *
 * Order is load-bearing: `**\/` before `**` before `*`. Consumed in the wrong order, a
 * `**` becomes two single stars and the pattern stops crossing a `/` — the result is a
 * regex that looks right and matches nothing.
 *
 * @type {ReadonlyArray<{ name: string, at: (glob: string, index: number, character: string | undefined) => { source: string, consume: number } | null }>}
 */
const TOKENS = [
  {
    name: 'directory-wildcard',
    at: (glob, index) =>
      glob.startsWith(`**/`, index) ? { source: '(?:[^/]+/)*', consume: 3 } : null,
  },
  {
    name: 'path-wildcard',
    at: (glob, index) => (glob.startsWith('**', index) ? { source: '.*', consume: 2 } : null),
  },
  {
    name: 'segment-wildcard',
    at: (_glob, index, character) => (character === '*' ? { source: '[^/]*', consume: 1 } : null),
  },
  {
    name: 'single-character',
    at: (_glob, index, character) => (character === '?' ? { source: '[^/]', consume: 1 } : null),
  },
  {
    name: 'alternatives',
    at: (glob, index) => (glob[index] === '{' ? braceAlternatives(glob, index) : null),
  },
  {
    name: 'character-class',
    at: (glob, index) => (glob[index] === '[' ? characterClass(glob, index) : null),
  },
];

/**
 * @param {string} glob
 * @param {number} open the index of the `[`
 * @returns {{ source: string, consume: number }}
 */
function characterClass(glob, open) {
  const close = glob.indexOf(']', open);
  if (close === -1) throw new Error(`unterminated character class in glob: ${glob}`);
  return { source: glob.slice(open, close + 1), consume: close - open + 1 };
}

/** Characters that are regex syntax and must be escaped when they appear literally. */
const LITERALS = '.+^$()|\\';

/**
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  if (typeof glob !== 'string' || glob.length === 0) {
    throw new Error(`a glob must be a non-empty string, got ${JSON.stringify(glob)}`);
  }
  const bare = bareDirectoryPattern(glob);
  if (bare !== null) return bare;

  let source = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const token = TOKENS.map((candidate) => [
      candidate,
      candidate.at(glob, index, glob[index]),
    ]).find(([, match]) => match !== null);
    if (token === undefined) {
      const character = glob[index] ?? '';
      source += LITERALS.includes(character) ? `\\${character}` : character;
      continue;
    }
    const [, match] = token;
    const consumed = /** @type {{ source: string, consume?: number }} */ (match);
    source += consumed.source;
    // `- 1` because the `for` loop increments too, and `consume` counts characters
    // *eaten* rather than characters *passed*. Without it, `**\/` advances four
    // positions for a three-character token and silently drops whatever followed — the
    // token after `**\/*` never sees the `*`, and the pattern matches nothing while
    // looking entirely reasonable.
    index += (consumed.consume ?? 1) - 1;
  }
  return new RegExp(`${source}$`);
}

/**
 * True when `file` matches any of the globs, with separators normalised.
 *
 * @param {string} file
 * @param {readonly string[]} globs
 * @returns {boolean}
 */
/**
 * @param {string} file
 * @param {readonly string[]} globs
 * @returns {boolean}
 */
export function matchesAny(file, globs) {
  const normalised = file.replaceAll('\\', '/');
  return (globs ?? []).some((glob) => globToRegExp(glob).test(normalised));
}
