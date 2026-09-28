import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  REPLACEMENT_CHARACTER,
  encodingProblems,
  findReplacementChars,
  looksLikeText,
} from './encoding-integrity.mjs';

/**
 * The rule is one code point, and the test that matters most is the one asserting what
 * it does **not** flag. This repository writes em-dashes and ellipses in prose on
 * purpose; a detector that flagged non-ASCII would fail on the very characters it
 * exists to protect, and the obvious response to that would be to delete the gate.
 * So the false-positive guards are not decoration.
 *
 * Every fixture that needs the damaged character builds it from `REPLACEMENT_CHARACTER`
 * rather than typing a literal. That is not style: the tree scan below reads this file,
 * so a literal here would make the gate fail on the test that proves the gate works.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * A string containing `count` replacement characters, built the safe way.
 *
 * @param {number} count
 * @returns {string}
 */
const damaged = (count) => REPLACEMENT_CHARACTER.repeat(count);

test('a replacement character is found, with its line and column', () => {
  const found = findReplacementChars(`first line\nsecond ${damaged(1)} line\n`);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
  assert.equal(found[0].column, 8);
});

test('a clean file yields nothing', () => {
  assert.deepEqual(findReplacementChars('nothing wrong here\n'), []);
});

test('every replacement character is reported, not just the first', () => {
  // One is enough to fail the gate, so reporting only the first would pass a file that
  // had been mangled in nine places — and a partial repair is worse than none, because
  // it looks finished.
  assert.equal(findReplacementChars(damaged(3)).length, 3);
});

test('legitimate non-ASCII prose is not flagged', () => {
  // The guard that keeps the gate usable. Every one of these appears in this
  // repository's comments on purpose, and each must pass untouched.
  const prose = [
    'an em-dash — with spaces',
    'an ellipsis … mid-sentence',
    'curly “quotes” and ‘apostrophes’',
    'accents: café, naïve, Ångström',
    'non-latin: Привет, 日本語, مرحبا',
    'symbols: → ≤ ≥ ± × ÷ § ¶ †',
  ].join('\n');
  assert.deepEqual(
    findReplacementChars(prose),
    [],
    'a gate that flags intended non-ASCII would be deleted, not narrowed',
  );
  assert.deepEqual(encodingProblems('src/x.ts', prose), []);
});

test('binary content is excluded by the NUL-byte heuristic, not by extension list', () => {
  assert.equal(looksLikeText(Buffer.from('plain text, no NULs')), true);
  assert.equal(looksLikeText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a])), false);
  // A file with a NUL past the sniff window is still text, which is the point of
  // sniffing a prefix rather than the whole buffer.
  const late = Buffer.concat([Buffer.from('a'.repeat(20_000)), Buffer.from([0x00])]);
  assert.equal(looksLikeText(late), true);
});

test('a finding names the cause, because the fix is not guessable', () => {
  const problems = encodingProblems('docs/x.md', `line one\nbad ${damaged(1)} char\n`);
  assert.equal(problems.length, 1);
  const [problem] = problems;
  assert.match(/** @type {string} */ (problem), /lossy encoding/);
  assert.match(/** @type {string} */ (problem), /line 2/);
  assert.match(/** @type {string} */ (problem), /bad/, 'the offending line should be quoted');
});

test('a long line is quoted around the damage, not from its start', () => {
  // The version this replaced truncated from the beginning of the line, so on a long
  // line it could quote 97 characters and omit the damage it was reporting — a finding
  // that pointed at a place with nothing wrong in it.
  const [hit] = findReplacementChars(`${'x'.repeat(400)} ${damaged(1)} tail`);
  assert.ok(/** @type {{ context: string }} */ (hit).context.includes(REPLACEMENT_CHARACTER));
  assert.ok(/** @type {{ context: string }} */ (hit).context.length <= 102);
});

test('a truncated finding marks both cuts', () => {
  // A reader has to be able to tell the quote is partial, or they will look for a
  // newline that is not there. Text on both sides of the character is what forces both
  // marks — with a long run after it, the window legitimately reaches the line end.
  const [hit] = findReplacementChars(`${'x'.repeat(400)} ${damaged(1)} ${'y'.repeat(400)}`);
  assert.match(/** @type {{ context: string }} */ (hit).context, /^…/);
  assert.match(/** @type {{ context: string }} */ (hit).context, /…$/);
});

test('a window that reaches the line end does not invent a trailing mark', () => {
  const [hit] = findReplacementChars(`${'x'.repeat(400)} ${damaged(1)} tail`);
  assert.match(/** @type {{ context: string }} */ (hit).context, /^…/);
  assert.ok(
    !(/** @type {{ context: string }} */ (hit).context.endsWith('…')),
    'the quote does reach the end of the line, so a trailing mark would be a lie',
  );
});

test('a short line is quoted whole, with no ellipses invented', () => {
  const [hit] = findReplacementChars(`a short line ${damaged(1)} ok\nnext`);
  assert.equal(
    /** @type {{ context: string }} */ (hit).context,
    'a short line <damage> ok'.replace('<damage>', REPLACEMENT_CHARACTER),
  );
});

test('a finding stays a readable length even when the line is enormous', () => {
  // A finding has to be usable in a pull request comment.
  const problems = encodingProblems('big.md', `${'x'.repeat(20_000)} ${damaged(1)}`);
  const [problem] = problems;
  assert.ok(/** @type {string} */ (problem).length < 600);
  assert.match(/** @type {string} */ (problem), /line 1/);
});

test('the exported code point is the one this is about', () => {
  // Guards against a refactor that "cleans up" the constant into a different character
  // and changes nothing, or into the wrong one.
  assert.equal(REPLACEMENT_CHARACTER, '\uFFFD');
  assert.equal(REPLACEMENT_CHARACTER.length, 1);
  assert.equal(REPLACEMENT_CHARACTER.codePointAt(0), 0xfffd);
});

test('the detector and this test contain no literal replacement character', () => {
  // The invariant that lets the tree scan below include this file. If someone pastes a
  // real U+FFFD in as a fixture — which is the natural thing to do — the gate starts
  // failing on the test that proves the gate works, and the tempting response is to
  // exclude these two paths rather than use the escape.
  for (const file of ['encoding-integrity.mjs', 'encoding-integrity.test.mjs']) {
    assert.deepEqual(
      encodingProblems(file, readFileSync(path.join(import.meta.dirname, file), 'utf8')),
      [],
      `${file} must build the character with \\uFFFD, not a literal`,
    );
  }
});

test('every tracked and untracked text file is valid UTF-8', () => {
  // The reason the module exists. `.github/workflows/unified-ci.yml` had eleven of
  // these committed across eight comments, and `apps/api/src/index.test.ts` had one,
  // and no other gate in this repository could see them: prettier reformats, eslint
  // parses, tsc reads tokens, and the tests assert behaviour. Prose corruption is
  // invisible to a toolchain that does not read prose.
  //
  // `--others --exclude-standard` so **untracked** files are included too. Plain
  // `git ls-files` lists only what has been `git add`ed, which means a new file could
  // carry mojibake through an entire pull request and only be caught after it landed —
  // and the moment it is caught is the moment a rebase is required. A gate that only
  // sees committed files is a gate that reports on the past.
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const files = [...new Set(listed.split('\0').filter(Boolean))];
  assert.ok(files.length > 100, `git ls-files returned ${String(files.length)} paths`);

  /** @type {string[]} */
  const problems = [];
  // `--cached` reports the index, which still names a file that has been deleted or
  // renamed in the working tree. Reading it raises ENOENT, so this gate used to crash
  // on any rename — and a gate that cannot survive a rename gets skipped or worked
  // around rather than fixed. A file that is not in the working tree has no bytes to
  // check, so it is skipped and **counted**: skipping is a decision, and a silent one
  // is indistinguishable from having measured nothing.
  /** @type {string[]} */
  const absent = [];
  for (const file of files) {
    const full = path.join(REPO_ROOT, file);
    if (!existsSync(full)) {
      absent.push(file);
      continue;
    }
    const buffer = readFileSync(full);
    if (!looksLikeText(buffer)) continue;
    problems.push(...encodingProblems(file, buffer.toString('utf8')));
  }

  assert.deepEqual(
    problems,
    [],
    `${String(problems.length)} text file(s) contain a U+FFFD replacement character. ` +
      'This is what a lossy write leaves behind — on Windows PowerShell 5.1 the ' +
      'default for Out-File and `>` is the system codepage, not UTF-8. Restore the ' +
      'intended characters and write the file as UTF-8. If this is a test fixture, ' +
      'build the character with a \\uFFFD escape rather than a literal.\n' +
      problems.join('\n'),
  );

  // Printed rather than swallowed, so a reader can tell "checked everything" from
  // "checked everything that still exists" — the second is what a rename produces.
  if (absent.length > 0) {
    console.log(
      `encoding-integrity: skipped ${String(absent.length)} path(s) in the index that ` +
        `are not in the working tree (deleted or renamed): ${absent.join(', ')}`,
    );
  }
});
