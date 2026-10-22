import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * `.github/workflows/docs.yml`, read as text and held to SITE-1's removal condition:
 * the workflow publishes `site/dist` **and** runs `SITE_DOCTOR_BUILT=1 pnpm site:doctor`
 * against the built output, before the artifact is uploaded, with no tolerated failure.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TEXT = readFileSync(path.join(REPO_ROOT, '.github/workflows/docs.yml'), 'utf8').replace(
  /\r\n/g,
  '\n',
);

/** Each `- name:` step of the build job, as text, in order. */
function buildSteps() {
  const build = TEXT.slice(TEXT.indexOf('\n  build:\n'), TEXT.indexOf('\n  deploy:\n'));
  return build.split(/^ {6}- (?=name:)/m).slice(1);
}

test('the build job runs site:doctor against the built output', () => {
  const steps = buildSteps();
  const doctor = steps.filter((step) => /pnpm site:doctor/.test(step));
  assert.equal(doctor.length, 1, 'exactly one step runs `pnpm site:doctor`');
  assert.match(doctor[0] ?? '', /SITE_DOCTOR_BUILT: ['"]?1['"]?\n/);
  const code = (doctor[0] ?? '').replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(code, /continue-on-error|\|\| true/);
});

test('site:doctor runs after the build and before the artifact is uploaded', () => {
  const steps = buildSteps();
  const at = (/** @type {RegExp} */ pattern) => steps.findIndex((step) => pattern.test(step));
  const built = at(/--filter @automate\/docs build/);
  const doctor = at(/pnpm site:doctor/);
  const upload = at(/upload-pages-artifact/);
  assert.ok(built !== -1 && doctor !== -1 && upload !== -1, 'all three steps exist');
  assert.ok(built < doctor, 'the doctor reads built output, so it follows the build');
  assert.ok(doctor < upload, 'a failing doctor must stop the upload');
});

test('the artifact published is site/dist', () => {
  assert.match(TEXT, /upload-pages-artifact@[0-9a-f]{40}\n\s+with:\n\s+path: site\/dist\n/);
});
