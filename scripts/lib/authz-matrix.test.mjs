import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ASSERTIONS,
  collectDriftEnvironment,
  driftFindings,
  unimplemented,
} from './docs-drift.mjs';

/**
 * The authz-matrix detector, proven against the three ways it can be wrong.
 *
 * This detector is static on purpose: it reads two committed files and reports the
 * gaps between them, so it runs in `pnpm docs:check` with no server and no
 * harness. That makes its failure modes the boring ones — a file that is missing,
 * a file that is not JSON, and rows that do not line up in either direction — and
 * each is asserted here rather than trusted.
 *
 * The **drift** half of the gate is the API suite's: whether each route still
 * answers the class its row records can only be observed by running the app, so
 * `apps/api/src/routes/authz-matrix.test.ts` owns it. Keeping the halves apart is
 * what makes both of them honest, and this file's cases only assert the static
 * one.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * An environment shaped like the real one, with one file replaced.
 *
 * `collectDriftEnvironment` derives every value it holds from the tree, so this
 * reuses it rather than hand-shaping an object — a fixture object would assert the
 * detector against an environment the real caller never produces.
 *
 * The file list is empty, which is the point: every other detector reads the
 * *documents* it finds, and with none listed they have nothing to report, so what
 * is left is exactly this detector. A test that ran all ten would pass or fail on
 * nine it is not about.
 *
 * @param {(relative: string) => string} read the matrix's contents
 * @returns {Parameters<typeof driftFindings>[0]}
 */
function environment(read) {
  return collectDriftEnvironment(
    root,
    (relative) =>
      relative === 'docs/quality/authz-matrix.json' ? read(relative) : safeRead(relative),
    () => [],
    new Set(),
    [],
  );
}

/** @param {string} relative @returns {string} */
function safeRead(relative) {
  try {
    return readFileSync(path.join(root, relative), 'utf8');
  } catch {
    return '';
  }
}

test('reports no finding against the committed matrix and route set', () => {
  assert.deepEqual(driftFindings(environment(safeRead)), []);
});

test('reports a canonical route with no row, by name', () => {
  const parsed = /** @type {{ rows: Array<{ path: string }> }} */ (
    JSON.parse(safeRead('docs/quality/authz-matrix.json'))
  );
  const trimmed = { rows: parsed.rows.filter((row) => row.path !== '/health') };
  const findings = driftFindings(environment(() => JSON.stringify(trimmed)));
  assert.ok(
    findings.some((finding) => finding.includes('GET /health')),
    `expected GET /health to be reported as unrecorded, got: ${findings.join(' | ')}`,
  );
});

test('reports a row for a route the product does not serve, by name', () => {
  // The direction a reader would not guess is the more important one: a row for a
  // removed route is a false claim about an endpoint that exists.
  const parsed = /** @type {{ rows: Array<unknown> }} */ (
    JSON.parse(safeRead('docs/quality/authz-matrix.json'))
  );
  const widened = {
    rows: [
      ...parsed.rows,
      {
        method: 'GET',
        path: '/api/v1/removed',
        status: 200,
        className: 'ok',
        limitation: null,
        note: 'tamper',
      },
    ],
  };
  const findings = driftFindings(environment(() => JSON.stringify(widened)));
  assert.ok(
    findings.some((finding) => finding.includes('/api/v1/removed')),
    `expected the stale row to be reported, got: ${findings.join(' | ')}`,
  );
});

test('reports a missing artefact rather than an empty finding', () => {
  const findings = driftFindings(environment(() => ''));
  assert.ok(
    findings.some((finding) => finding.includes('does not exist')),
    `expected a missing artefact to be reported, got: ${findings.join(' | ')}`,
  );
});

test('reports a malformed artefact rather than a parse crash', () => {
  const findings = driftFindings(environment(() => '{ not json'));
  assert.ok(
    findings.some((finding) => finding.includes('not JSON')),
    `expected a parse failure to be reported, got: ${findings.join(' | ')}`,
  );
});

test('reports a rows array that is not an array', () => {
  const findings = driftFindings(environment(() => JSON.stringify({ rows: 'none' })));
  assert.ok(
    findings.some((finding) => finding.includes('no rows array')),
    `expected a non-array to be reported, got: ${findings.join(' | ')}`,
  );
});

test('the detector is registered, so its absence is a finding rather than a zero', () => {
  // The rule this whole family of detectors exists under: an entry that is `null`
  // is reported as unimplemented, so the count in the site doctor's check 6 is a
  // real measurement rather than a list nobody reads.
  assert.equal(unimplemented().length, 0);
  assert.ok(ASSERTIONS.some((assertion) => assertion.id === 'authz-matrix'));
});
