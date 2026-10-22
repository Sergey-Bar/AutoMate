import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { summaryMarkdown } from '../skill-scan.mjs';

/**
 * How `pnpm skill-scan` is wired into CI while it is still `pr-reporting`.
 *
 * This does not claim the gate graduated. Graduation needs a CI run that printed a
 * `risk_assessment` with `is_complete: true`; until one exists the tier stays
 * `pr-reporting`, the step is tolerated, and the numbers are published to the job
 * summary so the next reader can see whether that condition has been met.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (/** @type {string} */ file) =>
  readFileSync(path.join(REPO_ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const ACTION = '.github/actions/install-skillspector/action.yml';
const CI = read('.github/workflows/unified-ci.yml');
const SECURITY_JOB = CI.slice(CI.indexOf('\n  security:\n'), CI.indexOf('\n  e2e:\n'));

test('the install action pins skillspector to a full commit and runs no unpinned install', () => {
  assert.ok(existsSync(path.join(REPO_ROOT, ACTION)), `${ACTION} must exist`);
  const text = read(ACTION);
  assert.match(
    text,
    /skillspector @ git\+https:\/\/github\.com\/NVIDIA\/SkillSpector\.git@[0-9a-f]{40}/,
  );
  assert.match(text, /skillspector --version/, 'the install verifies the binary answers');
  assert.doesNotMatch(text, /SkillSpector\.git['"]?\s*$/m, 'a bare git URL floats on main');
  assert.match(text, /uses: actions\/setup-python@[0-9a-f]{40}/);
});

test('the security job installs skillspector and runs skill-scan as a tolerated reporting step', () => {
  const install = SECURITY_JOB.indexOf('./.github/actions/install-skillspector');
  const scan = SECURITY_JOB.indexOf('pnpm skill-scan');
  assert.ok(install !== -1, 'the job calls the install action');
  assert.ok(scan > install, 'the scan follows the install');
  const step = SECURITY_JOB.slice(SECURITY_JOB.lastIndexOf('      - name:', scan));
  assert.match(step.split('\n      - ')[0] ?? '', /continue-on-error: true/);
  assert.match(step, /GITHUB_STEP_SUMMARY|skill-scan/);
});

test('the tier is still pr-reporting, and the manifest names the action that installs it', () => {
  const manifest = JSON.parse(read('scripts/gate-tooling.json'));
  assert.equal(manifest.tiers['skill-scan'], 'pr-reporting');
  assert.equal(manifest.scripts['skill-scan'].installedBy, '.github/actions/install-skillspector');
});

test('summaryMarkdown publishes is_complete, coverage and the degraded analyzers', () => {
  const report = {
    risk_assessment: { recommendation: 'DO_NOT_INSTALL', score: 56 },
    issues: [],
    analysis_completeness: {
      is_complete: false,
      coverage_percent: 95.8,
      scanned_components: 115,
      total_components: 120,
      analyzer_statuses: [{ analyzer_id: 'static_patterns_tool_misuse', status: 'degraded' }],
    },
  };
  const text = summaryMarkdown(report);
  assert.match(text, /is_complete[^\n]*false/);
  assert.match(text, /95\.8%/);
  assert.match(text, /static_patterns_tool_misuse/);
  assert.match(text, /DO_NOT_INSTALL/);
  assert.match(text, /not graduated|has not met/i);
  const complete = summaryMarkdown({
    ...report,
    analysis_completeness: { is_complete: true, coverage_percent: 100, analyzer_statuses: [] },
  });
  assert.match(complete, /is_complete[^\n]*true/);
  assert.doesNotMatch(complete, /has not met/i);
});
