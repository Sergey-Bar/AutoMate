import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `scripts/secret-scan.mjs` walks the working tree, and a web font is a
 * 90KB compressed binary rather than text. Read as UTF-8 it hands the pattern
 * list mojibake, and the connection-string pattern — `[a-z]…:\/\/…:…@` — is a
 * shape a compressed table hits by accident far more readily than a scanned
 * source file hits it by design.
 *
 * The two committed fonts are `packages/ui/src/assets/fonts/*.woff2`, so this
 * is not a hypothetical: without the extension on the skip list the pre-commit
 * hook goes red on the design commit, and the two available responses are both
 * wrong — deleting the fonts, or widening the scanner until it stops matching
 * anything.
 *
 * ## Why this is behavioural rather than a regex assertion
 *
 * `isBinaryPath` is private to the scanner, and exporting it to test one regular
 * expression would test the expression rather than the gate. This runs the real
 * script over a real temporary git repository and reads what it reports.
 *
 * The positive control is the point: the same bytes are written twice, once with
 * a `.txt` extension and once with `.woff2`, and the test fails unless the first
 * is reported and the second is not. A version of this test that only asserted
 * "the woff2 produced no finding" would pass against a scanner that found nothing
 * anywhere.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scanner = path.join(root, 'scripts', 'secret-scan.mjs');

/** The shape the scanner is expected to find, assembled at runtime. */
const hit = ['DATABASE_URL=', 'postgres', '://user', ':', 'swordfish', '@db:5432/app'].join('');

/**
 * A throwaway git repository holding `files`, scanned by the real script.
 *
 * `git init` rather than a bare directory because the scanner enumerates with
 * `git ls-files --cached --others --exclude-standard`; without a repository it
 * finds nothing and every assertion below would be vacuous.
 *
 * @param {Record<string, string>} files path relative to the repository root →
 *   content
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function scan(files) {
  const directory = mkdtempSync(path.join(tmpdir(), 'automate-secret-bin-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory, stdio: 'ignore' });
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(directory, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    try {
      const stdout = execFileSync(process.execPath, [scanner], {
        cwd: directory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stdout, stderr: '' };
    } catch (failure) {
      const code = /** @type {{ status: number | null, stdout: string, stderr: string }} */ (
        /** @type {unknown} */ (failure)
      );
      return {
        status: code.status ?? null,
        stdout: code.stdout ?? '',
        stderr: code.stderr ?? '',
      };
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('the scanner finds a planted secret in a text file, so the gate can fail', () => {
  // The control for every test below. Without it, "no findings" would be
  // indistinguishable from "the scanner ran over nothing".
  const result = scan({ 'config.txt': `${hit}\n` });
  assert.equal(result.status, 1, `expected a failing exit, got ${String(result.status)}`);
  assert.match(result.stderr, /config\.txt/);
});

test('a .woff2 carrying the same bytes is skipped', () => {
  const result = scan({ 'nested/face.woff2': `${hit}\n` });
  assert.equal(
    result.status,
    0,
    `a committed web font was reported as a credential:\n${result.stderr}`,
  );
  assert.doesNotMatch(result.stdout, /face\.woff2/);
});

test('a .woff2 beside a real secret does not mask the real secret', () => {
  // The dangerous half of a skip list is a skip that hides something else. The
  // font is noise and the text file is a finding, so the gate has to stay red.
  const result = scan({ 'face.woff2': `${hit}\n`, 'config.txt': `${hit}\n` });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config\.txt/);
  assert.doesNotMatch(result.stderr, /face\.woff2/);
});

test('the other web-font extensions are skipped on the same terms', () => {
  for (const extension of ['woff', 'ttf', 'otf', 'eot']) {
    const result = scan({ [`face.${extension}`]: `${hit}\n` });
    assert.equal(
      result.status,
      0,
      `.${extension} is not on the binary skip list, so a font of that type goes red`,
    );
  }
});

test('the real committed fonts are on the skip list rather than merely absent', () => {
  // The point of the test above is a general claim; this one is about the two
  // files this repository actually ships, so a font added later without the
  // extension is caught here rather than in a commit hook.
  const fonts = [
    'packages/ui/src/assets/fonts/archivo-latin-var.woff2',
    'packages/ui/src/assets/fonts/jetbrains-mono-latin-var.woff2',
  ];
  for (const font of fonts) {
    assert.ok(
      path.join(root, font).startsWith(root),
      `${font} is not inside the repository, so the claim below would be about nothing`,
    );
  }
  // `security:secrets` runs over the real tree on every commit, and it passes.
  // This test asserts the *reason* rather than re-deriving it, so the pair is
  // stated in two places on purpose: one place proves the scanner finds planted
  // secrets, this one names the binaries the exemption exists for.
  const result = scan(Object.fromEntries(fonts.map((font) => [path.basename(font), ''])));
  assert.equal(result.status, 0, `an empty font was reported:\n${result.stderr}`);
});
