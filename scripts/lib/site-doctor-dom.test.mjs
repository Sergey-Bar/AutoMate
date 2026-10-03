import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `site-doctor`'s checks 8 and 9, against a real built site.
 *
 * **This test exists because check 9 had never run.** Its DOM half needs
 * `SITE_DOCTOR_BUILT=1`, which is unset in CI and on a fresh checkout, and the reason
 * that is recorded — `pr-reporting` is the honest tier *while the site is not
 * deployed* — had quietly become "this half has never executed". The first run against
 * a build reported all nine pages as having no `lang`, because `hasLangAttribute`
 * anchored its `<html` search to the first token of the file and every page VitePress
 * emits starts with `<!DOCTYPE html>`.
 *
 * **The test builds the site itself.** `verify` runs `test:integration` *before*
 * `build`, so a test that assumed `site/dist` existed would fail on every checkout and
 * would be deleted. `vitepress build` takes about three seconds here and this suite
 * runs serially with nothing competing, which is exactly the reasoning
 * `scripts/lib/contract-double-assertion.test.mjs` records for the same trade.
 *
 * What is asserted is both directions, because the failure mode of "found nothing" is
 * a `GAP` that reads like a pass: the pages must be counted, every DOM check must have
 * run, and check 8's token half must be proven to still be able to fail.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const doctor = path.join(root, 'scripts', 'site-doctor.mjs');
const sitePackage = path.join(root, 'site');
const siteTheme = path.join(sitePackage, '.vitepress', 'theme', 'custom.css');

/** Build the site, so the DOM half has something to read. */
function buildSite() {
  execFileSync('npx', ['--no-install', 'vitepress', 'build', '.'], {
    cwd: sitePackage,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** @param {string} [extra] */
function runDoctor(extra = '') {
  try {
    return execFileSync(process.execPath, [doctor], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SITE_DOCTOR_BUILT: '1', ...(extra ? { X: extra } : {}) },
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (failure) {
    const result = /** @type {{ stdout: string }} */ (/** @type {unknown} */ (failure));
    return `${result.stdout ?? ''}`;
  }
}

buildSite();
const built = runDoctor();

test('every DOM check runs when the site is built, rather than reporting GAP', () => {
  assert.doesNotMatch(
    built,
    /^\s*GAP\s+\d\./m,
    `a DOM check reported GAP despite a build:\n${built}`,
  );
  assert.doesNotMatch(built, /^\s*fail\s+\d\./m, `site-doctor failed with a build:\n${built}`);
});

test('the built pages are counted, so the checks measured something', () => {
  // Nine pages is what this site publishes today. A number here is the difference
  // between "checks 7 to 9 ran" and "they found no problems in nothing" — which is
  // the shape a check has when its input is missing and it says `pass`.
  const rendered = /(\d+) page\(s\) rendered/.exec(built);
  assert.ok(rendered !== null, `no page count in the output:\n${built}`);
  assert.ok(Number(rendered[1] ?? '0') > 0, 'site-doctor rendered zero pages');
});

test('check 9 accepts a page whose <html> follows a doctype', () => {
  // The regression, stated directly so the shape is in the suite rather than only in
  // a commit message. `hasLangAttribute` anchored `^<html` at the first token, and
  // every file VitePress emits opens with `<!DOCTYPE html>`.
  assert.doesNotMatch(built, /has no lang on <html>/, 'a built page was reported without a lang');
});

test('check 8 reports both halves in its name, so a dropped half is visible', () => {
  assert.match(
    built,
    /pass\s+8\.\s+the site uses the product palette, and every image has alt text/,
  );
});

test('the token half of check 8 still fails on a site that ships its own palette', () => {
  // **The direction that matters, proved by breaking it.** A stylesheet that stops
  // importing `theme.css` and writes its own hex values is the drift this check
  // exists to catch, and it is visible from the source — so it has to fail.
  //
  // The real file is mutated and restored, rather than a fixture tree being copied:
  // `site-doctor` resolves `ROOT` from its own location, so a copy of the repository
  // would mean a second copy of every check, and a check that only exists in a test's
  // fixture is not the one that runs in the gate.
  const original = readFileSync(siteTheme, 'utf8');
  try {
    writeFileSync(
      siteTheme,
      original.replace(
        /@import '[^']*tokens\/(?:theme|fonts)\.css';\n/g,
        ':root {\n  --vp-c-bg: #0b0b0c;\n}\n',
      ),
      'utf8',
    );
    const output = runDoctor();
    assert.match(
      output,
      /imports no token stylesheet|does not import `theme\.css`/,
      'a site that stopped importing the product tokens still passed check 8',
    );
  } finally {
    writeFileSync(siteTheme, original, 'utf8');
  }
  // And the restore is itself asserted: a test that leaves the tree broken has moved
  // the defect rather than caught it.
  assert.equal(readFileSync(siteTheme, 'utf8'), original, 'custom.css was not restored');
});

test('check 8 catches a literal colour in the site stylesheet', () => {
  // A hex next to a token is the same drift one file later: the token set is right
  // and one surface has quietly stopped using it. `Canvas` and `CanvasText` are the
  // exception and are named in the check, because inside `forced-colors` they *are*
  // the user's palette by name.
  const original = readFileSync(siteTheme, 'utf8');
  try {
    writeFileSync(siteTheme, `${original}\n.rogue { color: #ff0000; }\n`, 'utf8');
    assert.match(runDoctor(), /has a literal colour/, 'a literal hex in the site passed check 8');
  } finally {
    writeFileSync(siteTheme, original, 'utf8');
  }
  assert.equal(readFileSync(siteTheme, 'utf8'), original);
});
