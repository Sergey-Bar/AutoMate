import { describe, expect, it } from 'vitest';
import { clusterFailures, failureSignature, type FailureInput } from './failure-clusters.js';

const sig = (message: string, stack?: string | null) => failureSignature(message, stack).signature;

describe('failureSignature', () => {
  it('takes the error type from the message, or from the first stack line', () => {
    expect(failureSignature('TypeError: x is not a function').errorType).toBe('TypeError');
    expect(failureSignature('  AssertionError [ERR_ASSERTION]: no').errorType).toBe(
      'AssertionError',
    );
    expect(failureSignature('java.lang.IllegalStateException: closed').errorType).toBe(
      'java.lang.IllegalStateException',
    );
    expect(failureSignature('boom', 'RangeError: boom\n    at f (/a.js:1:1)').errorType).toBe(
      'RangeError',
    );
    expect(failureSignature('expected 1 to be 2').errorType).toBeNull();
    expect(failureSignature('expected 1 to be 2', 'not a stack').errorType).toBeNull();
  });

  it('prefixes a type found only in the stack, without repeating one already in the message', () => {
    expect(sig('boom', 'RangeError: boom')).toBe('rangeerror: boom');
    expect(sig('RangeError: boom', 'RangeError: boom')).toBe('rangeerror: boom');
  });

  it('strips the volatile tokens', () => {
    expect(sig('Error: at 2026-10-21T08:15:30.123Z in 2026-10-21 08:15')).toBe(
      'error: at <time> in <time>',
    );
    expect(sig('run 0f8fad5b-d9cb-469f-a165-70867728950e failed')).toBe('run <uuid> failed');
    expect(sig('commit 9fceb02d0ae598e95dc970b74767f19372d61af8 and 0xDEADBEEF')).toBe(
      'commit <hex> and <hex>',
    );
    expect(sig('expected 42 to equal 3.14 after 3ms on v1.2.3')).toBe(
      'expected <n> to equal <n> after <n>ms on v<n>',
    );
    expect(sig(`expected 'alice' to be "bob" or \`carol\``)).toBe(
      `expected '<str>' to be "<str>" or \`<str>\``,
    );
    expect(sig('ENOENT: open /tmp/vitest-x81/a/b.json')).toBe('enoent: open <path>');
    expect(sig('failed in C:\\Users\\ci\\AppData\\Local\\Temp\\x\\y.ts:12:5')).toBe(
      'failed in <path>',
    );
    expect(sig('see ./src/a.ts:3:9 and ../b/c.ts and src/lib/util.ts:4')).toBe(
      'see <path> and <path> and <path>',
    );
    expect(sig('GET https://api.test:8443/v1/runs/12 returned 503')).toBe('get <url> returned <n>');
    expect(sig('connect ECONNREFUSED 127.0.0.1:5432')).toBe('connect econnrefused <n>:<n>');
    expect(sig('  lots   of\n\twhitespace  ')).toBe('lots of whitespace');
  });

  it('reads every ISO-8601 shape, a trailing full stop, and leaves non-paths alone', () => {
    expect(sig('on 2026-10-21, at 2026-10-21T08:15:30+02:00 or 2026-10-21T08:15Z')).toBe(
      'on <time>, at <time> or <time>',
    );
    expect(sig('exited with code 3.')).toBe('exited with code <n>.');
    expect(sig('see src/a.ts. and/or src/a.ts:1:2:3 and src/a.ts:x')).toBe(
      'see <path>. and/or src/a.ts:<n>:<n>:<n> and src/a.ts:x',
    );
  });

  it('keeps English words that happen to be hex, and apostrophes inside words', () => {
    expect(sig("Error: can't decode the added facade")).toBe(
      "error: can't decode the added facade",
    );
  });

  it('keeps the first two meaningful stack frames, skipping dependencies and runtime internals', () => {
    const stack = [
      'TypeError: x is not a function',
      '    at Object.<anonymous> (/repo/test/a.test.ts:3:1)',
      '    at lodash.map (/repo/node_modules/lodash/index.js:10:2)',
      '    at node:internal/process/task_queues:95:5',
      '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
      '    at async loadUser (/repo/src/users.ts:20:11)',
      '    at /repo/src/anonymous.ts:1:1',
      '    at internalHelper (internal/modules/cjs/loader.js:1:1)',
      '    at UserService.find (C:\\repo\\src\\service.ts:9:3)',
      '    at third (/repo/src/third.ts:1:1)',
      'renderList@http://localhost:5173/src/list.tsx:4:2',
    ].join('\n');
    expect(sig('TypeError: x is not a function', stack)).toBe(
      'typeerror: x is not a function @ loaduser < userservice.find',
    );
  });

  it('reads constructor frames and drops [as alias], skipping a line that is not a frame', () => {
    expect(
      sig(
        'Error: x',
        [
          '    at weird)',
          '    at new Widget (/repo/src/w.ts:1:1)',
          '    at Router.handle [as dispatch] (/repo/src/r.ts:1:1)',
        ].join('\n'),
      ),
    ).toBe('error: x @ widget < router.handle');
  });

  it('reads Firefox/Safari frames', () => {
    const stack = 'renderList@http://localhost:5173/src/list.tsx:4:2\n@debugger eval code:1:1';
    expect(sig('Error: x', stack)).toBe('error: x @ renderlist');
  });

  it('ignores an empty or missing stack', () => {
    expect(sig('Error: x', null)).toBe('error: x');
    expect(sig('Error: x', '')).toBe('error: x');
  });

  it('caps a very long message so one assertion diff cannot become a megabyte key', () => {
    expect(sig(`Error: ${'word '.repeat(1000)}`).length).toBeLessThanOrEqual(500);
  });

  it('normalises an adversarial message of a hundred thousand empty quotes in linear time', () => {
    const started = performance.now();
    const signature = sig(`Error: ${"'' ".repeat(100_000)}`);
    // Generous: the quadratic version took minutes on this input.
    expect(performance.now() - started).toBeLessThan(2000);
    expect(signature.startsWith("error: '<str>' '<str>' '<str>'")).toBe(true);
    expect(signature).not.toContain("''");
    expect(signature.length).toBeLessThanOrEqual(400);
  });

  it('reads a meaningful quote by the words just before it, however long the message', () => {
    const long = `${'padding '.repeat(30)}Cannot read properties of undefined (reading 'id')`;
    expect(sig(`TypeError: ${long}`)).toContain("(reading 'id')");
  });

  it('reads stack frames from the first 16 KB of the stack only', () => {
    const junk = 'not a frame\n'.repeat(2000);
    expect(sig('Error: x', `${junk}    at ownCode (src/a.ts:1:1)`)).toBe('error: x');
    expect(sig('Error: x', '    at ownCode (src/a.ts:1:1)')).toBe('error: x @ owncode');
  });

  // Pinned regressions: the normaliser must not merge errors that have different causes.
  it("keeps (reading 'id') and (reading 'name') apart: the property is the cause, not data", () => {
    const id = sig("TypeError: Cannot read properties of undefined (reading 'id')");
    const name = sig("TypeError: Cannot read properties of undefined (reading 'name')");
    expect(id).not.toBe(name);
    expect(id).toBe("typeerror: cannot read properties of undefined (reading 'id')");
    expect(sig("TypeError: Cannot set properties of null (setting 'x')")).toContain("'x'");
    expect(sig("Error: Cannot find module 'left-pad'")).toBe(
      "error: cannot find module 'left-pad'",
    );
    expect(sig("Error: Cannot find module '/tmp/a1/x.js'")).toBe(
      "error: cannot find module '<path>'",
    );
  });

  it('keeps ECONNREFUSED and ETIMEDOUT apart, and merges ECONNREFUSED on two ports', () => {
    const refused = sig('Error: connect ECONNREFUSED 127.0.0.1:5432');
    expect(refused).not.toBe(sig('Error: connect ETIMEDOUT 127.0.0.1:5432'));
    expect(refused).toBe(sig('Error: connect ECONNREFUSED 10.0.0.7:6379'));
  });
});

describe('clusterFailures', () => {
  const failures: FailureInput[] = [
    {
      runId: 'r1',
      testKey: 'a › logs in',
      branch: 'main',
      at: '2026-10-01T10:00:00Z',
      message: 'Error: connect ECONNREFUSED 127.0.0.1:5432',
    },
    {
      runId: 'r2',
      testKey: 'b › lists',
      branch: 'feature/x',
      at: '2026-10-03T10:00:00Z',
      message: 'Error: connect ECONNREFUSED 127.0.0.1:5433',
      stack: null,
    },
    {
      runId: 'r2',
      testKey: 'a › logs in',
      branch: null,
      at: '2026-09-30T10:00:00Z',
      message: 'Error: connect ECONNREFUSED 127.0.0.1:5434',
    },
    {
      runId: 'r3',
      testKey: 'c › saves',
      branch: 'main',
      at: '2026-10-02T10:00:00Z',
      message: "TypeError: Cannot read properties of undefined (reading 'id')",
      stack: 'TypeError: x\n    at save (/repo/src/save.ts:1:1)',
    },
    {
      runId: 'r3',
      testKey: 'd › zebra',
      branch: 'main',
      at: '2026-10-02T10:00:00Z',
      message: 'AssertionError: expected 1 to be 2',
    },
  ];

  it('groups by signature and summarises each cause', () => {
    const result = clusterFailures(failures);
    expect(result.totals).toEqual({ failures: 5, causes: 3 });
    expect(result.clusters[0]).toEqual({
      signature: 'error: connect econnrefused <n>:<n>',
      errorType: 'Error',
      sampleMessage: 'Error: connect ECONNREFUSED 127.0.0.1:5434',
      count: 3,
      tests: ['a › logs in', 'b › lists'],
      branches: ['feature/x', 'main'],
      runs: 2,
      firstSeen: '2026-09-30T10:00:00Z',
      lastSeen: '2026-10-03T10:00:00Z',
    });
    // Equal counts are ordered by signature, so the list is stable.
    expect(result.clusters.map((cluster) => cluster.signature).slice(1)).toEqual([
      'assertionerror: expected <n> to be <n>',
      "typeerror: cannot read properties of undefined (reading 'id') @ save",
    ]);
  });

  it('caps the clusters returned without changing the totals', () => {
    const result = clusterFailures(failures, { maxClusters: 1 });
    expect(result.clusters).toHaveLength(1);
    expect(result.totals).toEqual({ failures: 5, causes: 3 });
    expect(clusterFailures(failures, { maxClusters: 0 }).clusters).toEqual([]);
  });

  it('returns nothing for no failures', () => {
    expect(clusterFailures([])).toEqual({ clusters: [], totals: { failures: 0, causes: 0 } });
  });

  it('is independent of the order failures arrive in', () => {
    expect(clusterFailures([...failures].reverse())).toEqual(clusterFailures(failures));
  });

  it('picks the sample by time, then by message, so ties are stable', () => {
    const same = [
      { ...failures[0], message: 'Error: b 1', at: '2026-01-01T00:00:00Z' },
      { ...failures[0], message: 'Error: b 2', at: '2026-01-01T00:00:00Z' },
    ] as FailureInput[];
    expect(clusterFailures(same).clusters[0]?.sampleMessage).toBe('Error: b 1');
    expect(clusterFailures([...same].reverse()).clusters[0]?.sampleMessage).toBe('Error: b 1');
  });
});
