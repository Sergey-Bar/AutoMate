/**
 * The tenth anti-drift detector: the committed authz matrix covers the route set.
 *
 * `docs/quality/authz-matrix.json` is generated — recorded by
 * `apps/api/src/routes/authz-matrix.test.ts` against a harness that mounts every
 * route module — so the artefact is not a claim a person made. What *can* still
 * go wrong is the two ways the artefact and the route set drift apart without
 * anything running: a route is added to `route-manifest.ts` and nobody records
 * its row, and a route is removed while its row stays.
 *
 * Both are invisible to the API suite in one direction. `route-manifest.test.ts`
 * proves the array equals the app, so a route added there and not recorded still
 * leaves the API suite green — the matrix test only notices the *recorded* set,
 * and a route with no row fails inside the API suite only if somebody runs it.
 * This detector is what fails without any of that: it reads the committed files
 * and reports the two gaps by name.
 *
 * That is also why it is static and not a second recorder. A generator holding
 * its own copy of the route list is the defect this file's neighbours exist to
 * prevent, so the list is read from `route-manifest.ts` — the same source
 * `route-manifest.test.ts` proves against the running app — and the matrix is
 * read from JSON.
 */

import { canonicalRouteKeys } from './route-manifest.mjs';

/** Where the recorded matrix lives, repository-relative. */
export const AUTHZ_MATRIX_PATH = 'docs/quality/authz-matrix.json';

/**
 * @param {(relative: string) => string} read a file's contents, `''` when absent
 * @returns {string[]}
 */
export function authzMatrixFindings(read) {
  const findings = [];
  let keys;
  try {
    keys = canonicalRouteKeys();
  } catch (error) {
    return [`cannot read the route set: ${error instanceof Error ? error.message : String(error)}`];
  }

  const text = read(AUTHZ_MATRIX_PATH);
  if (text === '') {
    return [
      `${AUTHZ_MATRIX_PATH} does not exist, so no route has a recorded answer. ` +
        'Run AUTHZ_MATRIX_WRITE=1 pnpm --filter @automate/api exec vitest run ' +
        'src/routes/authz-matrix.test.ts to record one.',
    ];
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return [
      `${AUTHZ_MATRIX_PATH} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const rows = /** @type {{ rows?: unknown }} */ (parsed).rows;
  if (!Array.isArray(rows)) {
    return [`${AUTHZ_MATRIX_PATH} has no rows array, so no route has a recorded answer.`];
  }

  /** @type {string[]} */
  const recorded = [];
  /** @type {string[]} */
  const malformed = [];
  for (const [index, row] of rows.entries()) {
    const entry = /** @type {Record<string, unknown>} */ (row);
    const method = entry['method'];
    const routePath = entry['path'];
    const status = entry['status'];
    if (typeof method !== 'string' || typeof routePath !== 'string' || typeof status !== 'number') {
      malformed.push(`row ${String(index)} has no usable method, path and status`);
      continue;
    }
    recorded.push(`${method} ${routePath}`);
  }
  findings.push(...malformed.map((problem) => `${AUTHZ_MATRIX_PATH} ${problem}`));

  const canonical = new Set(keys);
  const present = new Set(recorded);

  const unrecorded = keys.filter((key) => !present.has(key));
  if (unrecorded.length > 0) {
    findings.push(
      `${AUTHZ_MATRIX_PATH} has no row for ${String(unrecorded.length)} canonical route(s): ` +
        `${unrecorded.join(', ')}. A route with no recorded answer is a surface nothing ` +
        'has measured.',
    );
  }

  // The direction that matters more, and the one a reader would not guess: a row
  // for a route the product no longer serves is a *false* claim about an
  // endpoint that exists, which is worse than a missing one.
  const stale = recorded.filter((key) => !canonical.has(key));
  if (stale.length > 0) {
    findings.push(
      `${AUTHZ_MATRIX_PATH} records ${String(stale.length)} route(s) the product does not serve: ` +
        `${stale.join(', ')}.`,
    );
  }

  return findings;
}
