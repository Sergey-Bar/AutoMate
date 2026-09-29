import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/** The repository root, for the committed data file this suite also reads. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * A key that appears twice inside one JSON object.
 *
 * @typedef {object} DuplicateKey
 * @property {string} id    the row the duplicate was found in
 * @property {string} key
 * @property {number} line
 */

/**
 * Finds a key declared twice inside the same JSON object.
 *
 * A tolerant scanner rather than a parse-and-compare, because `JSON.parse`
 * silently takes the last of a duplicated key: the parsed value and the file's
 * text can disagree with nothing in between to notice. That was the F-4 defect —
 * a row carrying `"band": "Major"` and then `"band": "Minor"`, where every tool
 * that read the row saw `Minor` and the `Major` existed only in the bytes.
 *
 * Scoped to one object by brace depth, so a key repeated across two *sibling*
 * rows — which is most of this file — is not reported.
 *
 * @param {string} source the whole file
 * @returns {DuplicateKey[]}
 */
export function duplicateKeys(source) {
  /** @type {DuplicateKey[]} */
  const found = [];
  /** @type {Map<number, Set<string>>} */
  const seenAtDepth = new Map();
  let id = '';
  let depth = 0;

  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim();
    const idMatch = /"id"\s*:\s*"([^"]+)"/.exec(line);
    if (idMatch) id = idMatch[1] ?? '';
    depth = walkLine(line, {
      depth,
      id,
      line: index + 1,
      seenAtDepth,
      onDuplicate: (key) => found.push({ id, key, line: index + 1 }),
    });
  }
  return found;
}

/**
 * Walks one line, reporting each key found and returning the depth after it.
 *
 * Left to right, so a key nested inside a value on the same line is attributed to
 * the *child* depth rather than the parent's. Collecting a line's properties first
 * and its depth afterwards — the obvious ordering — reports every `evidence[].id`
 * as a duplicate of its row's `id`, and every nested `path` as a duplicate of the
 * first, which is most of the file.
 *
 * Split out of `duplicateKeys` because the loop carries four branches and
 * `scripts/complexity-gate.mjs` ratchets on cognitive complexity per function;
 * the walk is the part that needs the explanation, not the part that needs to be
 * long.
 *
 * @param {string} line
 * @param {object} state
 * @param {number} state.depth
 * @param {string} state.id
 * @param {number} state.line
 * @param {Map<number, Set<string>>} state.seenAtDepth
 * @param {(key: string) => void} state.onDuplicate
 * @returns {number} the depth after this line
 */
function walkLine(line, state) {
  let { depth } = state;
  let cursor = 0;
  while (cursor < line.length) {
    const char = line[cursor];
    if (char === '"') {
      const end = line.indexOf('"', cursor + 1);
      if (end === -1) break;
      // A string followed by a colon is a key; anything else is a value, and a
      // value is prose that may contain braces, colons, and the word `band`.
      if (/^\s*:/.test(line.slice(end + 1))) recordKey(line.slice(cursor + 1, end), depth, state);
      cursor = end + 1;
      continue;
    }
    if (char === '{' || char === '[') {
      depth += 1;
      state.seenAtDepth.delete(depth);
    } else if (char === '}' || char === ']') {
      state.seenAtDepth.delete(depth);
      depth -= 1;
    }
    cursor += 1;
  }
  return depth;
}

/**
 * Notes one key at one depth, and reports it if this object already had it.
 *
 * @param {string} key
 * @param {number} depth
 * @param {object} state
 * @param {Map<number, Set<string>>} state.seenAtDepth
 * @param {(key: string) => void} state.onDuplicate
 */
function recordKey(key, depth, state) {
  const seen = state.seenAtDepth.get(depth) ?? new Set();
  if (seen.has(key)) state.onDuplicate(key);
  seen.add(key);
  state.seenAtDepth.set(depth, seen);
}

const LEDGER = path.join(REPO_ROOT, 'docs', 'quality', 'findings-ledger.json');
/**
 * @param {DuplicateKey} entry
 * @returns {string}
 */
const describeRow = (entry) => `${entry.id}: "${entry.key}" on line ${String(entry.line)}`;

test('the findings ledger carries no duplicate key in any row', () => {
  // F-4 was `"band": "Major"` followed by `"band": "Minor"`. `JSON.parse` takes the
  // last, so every tool that read the row saw `Minor` and the `Major` existed only
  // in the text — and a reviewer's eye is the only thing that reads the text. The
  // row's own summary records the re-band decision ("re-banded Major -> Minor"), so
  // `Minor` is the intended value and the duplicate was the defect.
  //
  // In a test rather than left to review because the failure is invisible by
  // construction: the file parses, every gate passes, and the value a human reads
  // in a diff is not the value the program uses.
  const found = duplicateKeys(readFileSync(LEDGER, 'utf8'));
  assert.deepEqual(
    found.map((entry) => describeRow(entry)),
    [],
  );
});

test('the duplicate detector fires, or the test above is vacuous', () => {
  // A detector that never fires is indistinguishable from a clean file.
  const duplicated = '{\n "findings": [\n  {"id": "X-1", "band": "Major", "band": "Minor"}\n ]\n}';
  const found = duplicateKeys(duplicated);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.id, 'X-1');
  assert.equal(found[0]?.key, 'band');
});

test('a key in two sibling rows is not a duplicate', () => {
  // It is most of this file, so reporting it would make the gate unusable.
  const siblings =
    '{\n "findings": [\n  {"id": "X-1", "band": "Major"},\n  {"id": "X-2", "band": "Major"}\n ]\n}';
  assert.deepEqual(duplicateKeys(siblings), []);
});

test('a key at two depths in one row is not a duplicate either', () => {
  // A row's own `id` and an `evidence[].id` are different objects that happen to
  // share a name. Treating that as a duplicate would make the gate noisy in the
  // one place the ledger is most structured.
  const nested =
    '{\n "findings": [\n  {"id": "X-1", "evidence": [{"id": "e1", "path": "a.ts"}]}\n ]\n}';
  assert.deepEqual(duplicateKeys(nested), []);
});

test('prose that mentions a key is not a declaration', () => {
  // The F-4 row's own `summary` contains the string `band` several times, in a
  // value that also contains braces. A scan that counted those would report the
  // fixed row as broken.
  const prose =
    '{\n "findings": [\n  {"id": "X-1", "summary": "re-banded Major -> Minor, so \\"band\\" follows"}\n ]\n}';
  assert.deepEqual(duplicateKeys(prose), []);
});

test('the committed ledger parses, and every row has exactly one usable band', () => {
  // Belt and braces: the text scan is brace-depth arithmetic, and this is the
  // parse it stands in for.
  const parsed = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const findings = Array.isArray(parsed) ? parsed : parsed['findings'];
  assert.ok(Array.isArray(findings) && findings.length > 0, 'the ledger has findings');
  for (const row of findings) {
    const band = row['band'];
    assert.ok(
      ['Blocker', 'Critical', 'Major', 'Minor'].includes(band),
      `${String(row['id'])} has the unexpected band ${String(band)}`,
    );
  }
});
