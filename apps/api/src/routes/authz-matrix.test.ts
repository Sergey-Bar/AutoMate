import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_API_ROUTES, canonicalRouteKey } from '../route-manifest.js';
import { isEndpoint, mountedApp, registeredRoutes } from '../test-support/route-manifest-app.js';

/**
 * What an anonymous caller receives, for every canonical route.
 *
 * There is no authentication in this product. `auth.sessions` is a `mock` row in
 * the capability register and every caller on every route is anonymous, so "the
 * answer class an anonymous caller receives" is *everything* a caller receives —
 * that is the premise the closing plan recorded as the open decision about what
 * this matrix asserts.
 *
 * So the matrix is a **golden expectation**, and that is what makes it worth
 * committing rather than a description. Each row is a measured fact about the
 * app as it stands: which routes answer `2xx`, which answer `4xx` and with
 * *what* code, and — the one that is not a restatement of anything — which
 * routes answer `5xx`, because a route that raises is indistinguishable from a
 * route that refuses by `throw`ing a `DomainError` unless something records the
 * difference.
 *
 * **What it catches.** A route whose answer class changes fails. A route that
 * starts answering `500` fails, which is the case that would otherwise be read
 * as "that handler is strict". A route added to the canonical list without a row
 * fails, so a new endpoint is a deliberate act against a recorded answer rather
 * than an unmapped surface. A row whose route is no longer canonical fails, so
 * the matrix cannot carry an answer for a path nothing serves.
 *
 * **What it does not catch, and why that is stated.** It does not authorise
 * anything. Nothing in the API requires an authorization decision, so nothing
 * here proves that a route *should* be readable; it proves only that the route
 * answers what it answered when the row was recorded. The moment the product
 * gains a second role, this matrix stops describing the posture and starts
 * describing the harness, and the rows need regenerating against an
 * authenticated caller. `docs/migration/capability-register.md` is where that
 * step is tracked.
 *
 * **Read-only by default.** Nothing writes the artefact unless
 * `AUTHZ_MATRIX_WRITE=1` is set, which is what keeps this a check and not a
 * recorder that overwrites the thing it is measuring. The repo already learned
 * this once: the generated status pages were checked by running the generator
 * and then comparing, which regenerated the very files it was checking, so the
 * check passed whatever the committed state was.
 */

/** One answer class, the coarsest granularity that still separates a refusal from a crash. */
type AnswerClass = 'ok' | 'redirect' | 'client_error' | 'not_found' | 'server_error' | 'other';

/** @param {number} status @returns {AnswerClass} */
function classify(status: number): AnswerClass {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'redirect';
  if (status === 404) return 'not_found';
  if (status >= 400 && status < 500) return 'client_error';
  if (status >= 500) return 'server_error';
  return 'other';
}

/**
 * The three places the harness provably cannot serve a route, named.
 *
 * A row answering 5xx is a finding **unless** a limitation here covers it, and
 * each entry has to say which part of the harness causes it — so an unattributed
 * 5xx fails the suite below. That is the whole design: the exceptions are data
 * with a reason beside them, and a route that starts raising outside them is a
 * defect the matrix reports rather than absorbs.
 *
 * | Limitation | Routes | Why |
 * |---|---|---|
 * | No dependency registry | `/ready`, `/api/v1/ready` | Health reports 503 for a degraded dependency and the harness has none, which is the honest answer for a store that is not there. |
 * | The refusing AI gateway | `/api/v1/chat/models` | The harness deliberately mounts the unconfigured gateway, because a real one needs a provider and the route is the same either way. |
 * | The `{} as never` database | the project registry and everything under it | `createProjectsRoutes` takes a database and the harness has none, so every project read raises. The manifest test records the cast; this records its consequence. |
 *
 * Named once, here, because three is the number of harness limitations and not
 * the number of routes: the project entry covers seventeen by prefix, and a
 * fourth limitation has to be added with its reason rather than silently
 * widening a pattern someone else wrote.
 */
const HARNESS_LIMITATIONS: ReadonlyArray<{
  id: string;
  covers: (canonicalPath: string) => boolean;
  note: string;
}> = [
  {
    id: 'no dependency registry',
    covers: (canonicalPath) => canonicalPath === '/ready' || canonicalPath === '/api/v1/ready',
    note: 'The harness mounts no dependency registry, so health answers 503 rather than reporting dependencies it does not have. The route is the product’s; the answer is the harness’s.',
  },
  {
    id: 'the refusing AI gateway',
    covers: (canonicalPath) => canonicalPath === '/api/v1/chat/models',
    note: 'The harness mounts the unconfigured AI gateway, which refuses rather than needing a provider. A real gateway answers 200 here.',
  },
  {
    id: 'the empty database',
    covers: (canonicalPath) =>
      canonicalPath === '/api/v1/projects' || canonicalPath.startsWith('/api/v1/projects/'),
    note: 'The project registry takes a database and the harness has none — the `{} as never` cast `route-manifest.test.ts` records — so every project read raises. Against a real PostgreSQL this route answers its own 2xx or 4xx.',
  },
];

/**
 * One recorded row.
 *
 * `status` is the exact code rather than only the class, because two routes that
 * both answer `4xx` with `401` and `403` are answering different questions and
 * the class alone would read them as the same route. The class is derived, so
 * the file cannot disagree with itself.
 */
type AuthzRow = {
  method: string;
  path: string;
  /** The code the harness answered. */
  status: number;
  /** Derived from `status`, so the two cannot disagree. */
  className: AnswerClass;
  /** The harness limitation that explains a 5xx, or `null` when none does. */
  limitation: string | null;
  /** Why that answer is the right one, in a sentence a reader can check. */
  note: string;
};

// Four levels up from `apps/api/src/routes` to the repository root, which is where
// the committed artefact lives: the matrix is a *record*, not package state, so a
// reader finds it beside the other quality artefacts and not inside `apps/api`.
const MATRIX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'docs',
  'quality',
  'authz-matrix.json',
);

/** @returns {{ rows: AuthzRow[] }} */
function readMatrix(): { rows: AuthzRow[] } {
  const parsed = JSON.parse(readFileSync(MATRIX, 'utf8')) as { rows?: unknown };
  if (!Array.isArray(parsed.rows)) {
    throw new Error(
      'docs/quality/authz-matrix.json has no rows array. Run with ' +
        'AUTHZ_MATRIX_WRITE=1 to record one.',
    );
  }
  return { rows: parsed.rows as AuthzRow[] };
}

/**
 * A concrete address for one canonical route.
 *
 * Every path parameter is replaced with a **well-formed identifier that does not
 * exist**, so a `2xx` can only mean the route read no argument and a `404` means
 * it looked one up and missed. Using a value that happens to exist would make
 * the row answer a question about the fixture rather than about the route.
 *
 * @param {string} path
 * @returns {string}
 */
function addressFor(canonicalPath: string): string {
  return canonicalPath.replaceAll(/:([A-Za-z0-9_]+)/gu, (_match, name: string) =>
    name === 'runId' ? 'run-absent' : `${name}-absent`,
  );
}

/**
 * What each canonical route answers, asked of the harness.
 *
 * Sequential, and on purpose: it is eighty-odd requests against an in-process
 * Hono app, and concurrency buys microseconds while making a failure's route
 * hard to read out of an interleaved log.
 *
 * @returns {Promise<AuthzRow[]>}
 */
async function observe(): Promise<AuthzRow[]> {
  const app = mountedApp();
  /** @type {AuthzRow[]} */
  const rows = [];
  for (const [method, canonicalPath] of CANONICAL_API_ROUTES) {
    const response = await app.request(addressFor(canonicalPath), { method });
    const status = response.status;
    rows.push({
      method,
      path: canonicalPath,
      status,
      className: classify(status),
      limitation: limitationFor(canonicalPath),
      note: '',
    });
  }
  return rows;
}

/** The harness limitation covering a path, or `null` when none does. */
function limitationFor(canonicalPath: string): string | null {
  const matched = HARNESS_LIMITATIONS.filter((limitation) => limitation.covers(canonicalPath));
  // Exactly one: two limitations claiming the same route is a matrix that cannot
  // say which reason produced the answer, which is the same as no reason.
  if (matched.length > 1) {
    throw new Error(
      `${canonicalPath} is covered by ${String(matched.length)} harness limitations ` +
        `(${matched.map((one) => one.id).join(', ')}). A limitation covers a route once.`,
    );
  }
  return matched[0]?.id ?? null;
}

/** The note for one row, written from the answer rather than from a guess. */
function noteFor(row: AuthzRow): string {
  const limitation = HARNESS_LIMITATIONS.find((one) => one.id === row.limitation);
  if (limitation !== undefined) return limitation.note;
  if (row.className === 'ok')
    return 'Answers without credentials or arguments, because the route needs neither and reads no resource.';
  if (row.className === 'not_found')
    return 'Accepts the call with no credentials and refuses because the resource does not exist, which is the refusal the harness is designed to provoke.';
  if (row.className === 'client_error')
    return 'Refuses before reading a resource: validation, a missing secret, or a body the harness did not supply.';
  if (row.className === 'server_error')
    return '**Answers 5xx and no harness limitation names it.** Held as a defect, not as a posture.';
  return 'Answers with something that is none of the four classes above, which is itself a finding.';
}

describe('what an anonymous caller receives, for every canonical route', () => {
  it('has a recorded answer for every canonical route, and only for those', async () => {
    const canonical = new Set(
      CANONICAL_API_ROUTES.map(([method, path]) => canonicalRouteKey(method, path)),
    );
    const recorded = readMatrix().rows.map((row) => canonicalRouteKey(row.method, row.path));

    const unrecorded = [...canonical].filter((key) => !recorded.includes(key));
    expect(unrecorded).toEqual([]);

    // The other direction, and it is the one that keeps the matrix from growing a
    // memory of a route set that no longer exists.
    const stale = recorded.filter((key) => !canonical.has(key));
    expect(stale).toEqual([]);
  });

  it('records the answer class the harness actually gives, for every canonical route', async () => {
    const recorded = readMatrix().rows;
    const observed = await observe();
    const byKey = new Map(recorded.map((row) => [canonicalRouteKey(row.method, row.path), row]));

    const drift: string[] = [];
    for (const row of observed) {
      const expected = byKey.get(canonicalRouteKey(row.method, row.path));
      if (expected === undefined) continue; // reported by the case above
      if (expected.status !== row.status) {
        drift.push(
          `${canonicalRouteKey(row.method, row.path)} answers ${String(row.status)}, matrix says ${String(expected.status)}`,
        );
      }
    }
    expect(drift).toEqual([]);

    // And no route raises unless a harness limitation names it. This is the
    // assertion the matrix exists for: a route that raises is a route that
    // fails, and without this the matrix would faithfully record the crash and
    // call it a posture.
    const crashing = observed
      .filter((row) => row.className === 'server_error' && row.limitation === null)
      .map((row) => canonicalRouteKey(row.method, row.path));
    expect(crashing).toEqual([]);

    // And the other half, so the limitation list cannot be used as a blanket
    // exception or left to rot: **every limitation has to be earning its place**
    // by explaining at least one recorded row.
    //
    // The first version of this assertion was the reverse mapping — every route a
    // limitation covers must answer 5xx — and it failed on `POST /api/v1/projects`,
    // which refuses at body validation before it ever reaches the database the
    // limitation is about. So covering a route does not mean causing its answer,
    // and asserting it would have failed on a harness working correctly.
    //
    // What is still load-bearing, and is asserted instead: a limitation covering
    // no 5xx row at all is dead data in the exception list, waiting for the next
    // route to be added beside it. When the project registry starts answering
    // properly, that entry shows up here as unused and somebody deletes it.
    const unusedLimitations = HARNESS_LIMITATIONS.filter((limitation) => {
      if (CANONICAL_API_ROUTES.some(([, canonicalPath]) => limitation.covers(canonicalPath)))
        return false;
      return !observed.some((row) => row.limitation === limitation.id);
    }).map((limitation) => limitation.id);
    expect(unusedLimitations).toEqual([]);
  });

  it('asks the harness the routes the app registers, not a second list', async () => {
    // The matrix walks `CANONICAL_API_ROUTES`, so it can only ever cover the
    // manifest. This is what proves the manifest and the app are the same set —
    // without it a route could be registered, recorded against no row, and this
    // suite would stay green.
    const registered = (await registeredRoutes(mountedApp())).filter(isEndpoint);
    expect(new Set(registered.map((route) => canonicalRouteKey(route.method, route.path)))).toEqual(
      new Set(CANONICAL_API_ROUTES.map(([method, path]) => canonicalRouteKey(method, path))),
    );
  });

  it('records, when asked to, and rewrites every note from the answer', async () => {
    if (process.env['AUTHZ_MATRIX_WRITE'] !== '1') {
      // Not skipped in silence: a run that cannot record is a run that must still
      // check, and the two cases above are the check.
      return;
    }
    const observed = await observe();
    const rows = observed.map((row) => ({ ...row, note: noteFor(row) }));
    writeFileSync(MATRIX, `${JSON.stringify({ rows }, null, 2)}\n`, 'utf8');
    // Deliberately one assertion, so a recording run cannot pass while having
    // written something the next check would reject.
    expect(rows.length).toBe(CANONICAL_API_ROUTES.length);
  });
});
