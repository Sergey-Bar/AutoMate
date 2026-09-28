/**
 * The repository's text must be UTF-8, and this is what proves it.
 *
 * A lossy write — and on Windows PowerShell 5.1 the default for `Out-File`, `>` and
 * `Set-Content` is the system codepage, not UTF-8 — does not throw. It writes the file
 * happily, replaces every character it cannot encode with U+FFFD, and produces
 * something that still parses, still lints, still passes every test, and reads as
 * slightly off. The damage is confined to prose in practice, which is exactly why
 * nothing noticed: `.github/workflows/unified-ci.yml` had **eleven** of them committed
 * across eight comments, and `apps/api/src/index.test.ts` had one, for as long as the
 * file has been on disk.
 *
 * Nothing else in the gate chain catches this. Prettier reformats; it does not repair
 * mangled bytes. ESLint parses; the comment is still a comment. `tsc` reads tokens and
 * never sees prose. The tests assert behaviour and cannot see an em-dash that became a replacement character. So a check that cannot fail sits over a class of silent corruption.
 *
 * **What this deliberately does not do.** It does not require ASCII, and it must not:
 * this repository writes em-dashes, ellipses and typographic quotes in prose on
 * purpose, and a rule that flagged non-ASCII would fail on the very characters it is
 * protecting. The test asserts that a real `—` and a real `…` are *not* flagged,
 * because a detector that flags them would be removed rather than narrowed.
 *
 * The signal is exactly one code point, U+FFFD. In a file that was written as UTF-8 it
 * is a decoding artefact and never an author's intent — nobody types it.
 *
 * **This module does not contain a literal U+FFFD, and neither does its test.** That is
 * not incidental tidiness: the gate scans untracked files as well as tracked ones, so
 * it reads this file, and a literal here would make the gate fail on its own detector.
 * The constant below is the escape sequence, and the test builds its inputs the same
 * way. A gate that cannot be applied to itself is a gate with a permanent exemption.
 */

/**
 * The one code point this module is about.
 *
 * Written as an escape, never as the character. The gate reads this file — it scans
 * untracked files precisely so a new one is covered before it is committed — and a
 * literal here would make the gate fail on its own detector.
 */
export const REPLACEMENT_CHARACTER = '\uFFFD';

/** How much of a file to sniff when deciding whether it is text at all. */
const SNIFF_BYTES = 8_192;

/**
 * Whether a buffer looks like text, by the standard heuristic: binary content has NUL
 * bytes near the start, prose does not. Used to skip images and archives in the
 * committed-tree scan, where decoding as UTF-8 would manufacture replacement
 * characters out of arbitrary bytes and produce findings nobody could act on.
 *
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function looksLikeText(buffer) {
  return !buffer.subarray(0, SNIFF_BYTES).includes(0);
}

/**
 * Every replacement character in a string, with enough context to find it.
 *
 * The `context` is trimmed and length-bounded deliberately: a finding has to be
 * actionable, and a gate that dumps whole files into a pull request comment is a gate
 * nobody reads.
 *
 * @param {string} text
 * @returns {Array<{ line: number, column: number, context: string }>}
 */
export function findReplacementChars(text) {
  /** @type {Array<{ line: number, column: number, context: string }>} */
  const found = [];
  for (const [index, char] of [...text].entries()) {
    if (char !== REPLACEMENT_CHARACTER) continue;
    const before = text.slice(0, index);
    const line = before.split('\n').length;
    const column = index - (before.lastIndexOf('\n') + 1) + 1;
    found.push({ line, column, context: contextAround(text, index) });
  }
  return found;
}

/** How much of the offending line a finding quotes. */
const CONTEXT_WIDTH = 100;

/**
 * A short window of the line *around* a character, for a failure message.
 *
 * Centred on the character rather than taken from the start of the line, which is the
 * version this replaced and the version that was wrong: on a long line it could quote
 * 97 characters and omit the very damage it was reporting, so the finding pointed at a
 * place with nothing wrong in it. A truncated context is only useful if what was cut is
 * on the far side of the thing being reported.
 *
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function contextAround(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  const line = text.slice(start, end === -1 ? text.length : end);
  const at = index - start;
  if (line.length <= CONTEXT_WIDTH) return line.trim();

  const half = Math.floor(CONTEXT_WIDTH / 2);
  const from = Math.max(0, at - half);
  const to = Math.min(line.length, from + CONTEXT_WIDTH);
  return [from > 0 ? '…' : '', line.slice(from, to).trim(), to < line.length ? '…' : ''].join('');
}

/**
 * The problems with one file's text, phrased so the fix is obvious.
 *
 * The cause is named in the message because the fix is not guessable: a reader who has
 * never hit a lossy write will assume the character is a font or a terminal artifact and
 * will dismiss the finding, which is how it survived the first time.
 *
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
export function encodingProblems(file, text) {
  const found = findReplacementChars(text);
  if (found.length === 0) return [];
  const where = found
    .slice(0, 5)
    .map((hit) => `line ${String(hit.line)} col ${String(hit.column)}: ${hit.context}`)
    .join('; ');
  const more = found.length > 5 ? ` (+${String(found.length - 5)} more)` : '';
  return [
    `${file}: ${String(found.length)} replacement character(s) — U+FFFD is what a ` +
      `decoder emits for a byte it cannot read, so this file was written with a lossy ` +
      `encoding rather than UTF-8. Nothing in the gate chain catches it: prettier ` +
      `reformats, eslint parses, and tests assert behaviour, none of which can see a ` +
      `prose character. Restore the intended characters and write the file as UTF-8 ` +
      `(${where}${more}).`,
  ];
}
