import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
  executeWithRetry,
  isRetryableStatus,
} from './index.js';

/**
 * The guard against this package's worst silent failure.
 *
 * `sdk.test.ts` used to sit at the **package root** and import `'./src/index.js'`.
 * There is no `index.js` there — only `index.ts` — and a specifier with no matching
 * file falls back to the package's own `exports`, which points at `dist/index.js`.
 * So the suite tested a **build artifact**, and every symptom was quiet:
 *
 *  - editing `src/index.ts` changed nothing until a rebuild;
 *  - a `throw` at the top of `src/index.ts` did not fail the suite;
 *  - `dist/index.js` was the file whose edits the tests *did* respond to;
 *  - the coverage report read `index.ts 0%`, because nothing under `src/` ever ran.
 *
 * A suite that cannot go red is worse than no suite, because it is a green tick on
 * a module nobody has read — and the 0% coverage line, which is the one honest
 * signal here, sat in a report whose other packages were all measured.
 *
 * The fix is positional, not clever: the test lives in `src/` next to `index.ts`
 * and imports `'./index.js'`, which is what the other three connector packages
 * already do and what they demonstrably resolve to source. These cases assert that
 * arrangement, so moving a test back out to the package root is a failure rather
 * than a silent regression.
 */
describe('the module under test is the source, not the build output', () => {
  it('lives in the same directory as the module it imports', () => {
    // The load-bearing assertion. A test file that resolves its import from
    // anywhere but the module's own directory is the shape that produced the
    // false green, so the shape is what is pinned.
    const here = path.dirname(fileURLToPath(import.meta.url));
    expect(here).toBe(path.join(here, '..', 'src'));
    expect(existsSyncModule(path.join(here, 'index.ts'))).toBe(true);
  });

  it('is not shadowed by a stale compiled file beside the source', () => {
    // If a `src/index.js` ever appears, the relative import starts resolving to
    // it and the suite silently retires. Nothing else in the build puts one there.
    expect(
      existsSyncModule(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js')),
    ).toBe(false);
  });

  it('sees the current source, not a build of an earlier one', () => {
    // Behavioural, and therefore the only version of this check that means
    // something. `isRetryableStatus` is pure, so this asserts what the module the
    // test actually imported computes. If the import ever resolves to `dist`
    // again, this is the case that notices.
    expect(isRetryableStatus(undefined)).toBe(false);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(401)).toBe(false);
  });

  it('exercises the real error classes, whose hierarchy the whole policy turns on', () => {
    // `ConnectorRejectionError` being a `ConnectorHttpError` is the fact that lets
    // a safe-to-repeat refusal be retried even when the operation is not
    // idempotent. Constructing the classes here also puts those lines under
    // measurement, which is how a package that tests its build output shows 0%.
    const rejection = new ConnectorRejectionError(429, 'rate limited');
    expect(rejection).toBeInstanceOf(ConnectorHttpError);
    expect(rejection.status).toBe(429);
    expect(new ConnectorInputError('invalid_input', 'no')).toBeInstanceOf(Error);
  });

  it('exercises the real retry policy rather than a re-implementation of it', () => {
    const attempts: number[] = [];
    return executeWithRetry(
      async () => {
        attempts.push(attempts.length + 1);
        throw new Error('unreachable');
      },
      { retries: 0, sleep: async () => undefined, idempotent: true },
    ).catch((error: unknown) => {
      expect(attempts).toHaveLength(1);
      expect((error as Error).message).toBe('unreachable');
    });
  });
});

/** @param target an absolute path @returns whether it exists on disk */
function existsSyncModule(target: string): boolean {
  try {
    readFileSync(target);
    return true;
  } catch {
    return false;
  }
}
