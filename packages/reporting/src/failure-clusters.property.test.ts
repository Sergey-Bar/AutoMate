import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clusterFailures, failureSignature, type FailureInput } from './failure-clusters.js';

/**
 * Property suite for CLUSTER-1 and CLUSTER-2.
 *
 * Fixed seed and `numRuns`. Each template is one root cause written with slots for the
 * tokens that vary between occurrences of it; two independent fillings of the same
 * template are the same cause, and two templates are two causes. CLUSTER-1 says the
 * fillings never split a cause; CLUSTER-2 says they never merge two.
 */
const SEED = 20261104;
const params = { seed: SEED, numRuns: 300 } as const;

type Slot = 'n' | 'uuid' | 'hex' | 'path' | 'time' | 'str';
type Part = string | { slot: Slot };
const n = { slot: 'n' } as const;
const uuid = { slot: 'uuid' } as const;
const hex = { slot: 'hex' } as const;
const path = { slot: 'path' } as const;
const time = { slot: 'time' } as const;
const str = { slot: 'str' } as const;

const TEMPLATES: readonly Part[][] = [
  ['Error: connect ECONNREFUSED 127.0.0.1:', n],
  ['Error: connect ETIMEDOUT ', n, '.', n, '.', n, '.', n, ':', n],
  ['TimeoutError: request ', uuid, ' timed out after ', n, 'ms'],
  ['Error: ENOENT: no such file or directory, open ', path],
  ['AssertionError: expected ', n, ' to equal ', n, ' at ', time],
  ['Error: commit ', hex, ' not found in ', path, ':', n, ':', n],
  ["TypeError: Cannot read properties of undefined (reading 'id') in run ", n],
  ["TypeError: Cannot read properties of undefined (reading 'name') in run ", n],
  ['SnapshotError: snapshot "', str, '" does not match ', time, ' baseline ', uuid],
  ['Error: worker ', hex, ' exited with code ', n, ' in ', path],
];

const segment = fc.string({ unit: fc.constantFrom(...'abcxyz019_-'), minLength: 1, maxLength: 8 });
const segments = fc.array(segment, { minLength: 2, maxLength: 4 });
const HEX = '0123456789abcdef';

const TOKENS: Record<Slot, fc.Arbitrary<string>> = {
  n: fc.nat({ max: 1_000_000_000 }).map(String),
  uuid: fc.uuid(),
  hex: fc
    .tuple(
      fc.constantFrom(...'0123456789'),
      fc.constantFrom(...'abcdef'),
      fc.string({ unit: fc.constantFrom(...HEX), minLength: 4, maxLength: 36 }),
    )
    .map(([digit, letter, rest]) => `${digit}${letter}${rest}`),
  path: fc.oneof(
    segments.map((parts) => `/${parts.join('/')}.ts`),
    segments.map((parts) => `C:\\${parts.join('\\')}.js`),
    segments.map((parts) => `./${parts.join('/')}.mjs`),
    segments.map((parts) => `${parts.join('/')}.json`),
    segments.map((parts) => `/tmp/vitest-${parts.join('')}/out.log`),
  ),
  time: fc
    .date({
      min: new Date('2000-01-01T00:00:00Z'),
      max: new Date('2099-12-31T00:00:00Z'),
      noInvalidDate: true,
    })
    .map((date) => date.toISOString()),
  str: fc.string({ unit: fc.constantFrom(...'abc XYZ09:/.-_'), maxLength: 20 }),
};

function fill(template: readonly Part[]): fc.Arbitrary<string> {
  return fc
    .tuple(
      ...template.map((part) => (typeof part === 'string' ? fc.constant(part) : TOKENS[part.slot])),
    )
    .map((parts) => parts.join(''));
}

const index = fc.nat({ max: TEMPLATES.length - 1 });
/** Template indices, each filled twice independently. */
const pairs = fc
  .array(index, { minLength: 1, maxLength: 12 })
  .chain((indices) =>
    fc.tuple(
      fc.constant(indices),
      fc.tuple(...indices.map((at) => fill(TEMPLATES[at] as Part[]))),
      fc.tuple(...indices.map((at) => fill(TEMPLATES[at] as Part[]))),
    ),
  );

const asFailures = (messages: readonly string[]): FailureInput[] =>
  messages.map((message, at) => ({
    runId: `r${String(at % 3)}`,
    testKey: `t${String(at % 4)}`,
    branch: 'main',
    at: '2026-10-01T00:00:00Z',
    message,
  }));

/** CLUSTER-1, as a predicate over a signer, so the harness check can run it on a naive one. */
function fillingsAgree(
  sign: (message: string) => string,
  first: readonly string[],
  second: readonly string[],
): boolean {
  return first.every((message, at) => sign(message) === sign(second[at] as string));
}

const ours = (message: string) => failureSignature(message).signature;

describe('CLUSTER-1: renaming volatile tokens never changes the clustering', () => {
  it('gives every filling of one cause the same signature, and the same clusters', () => {
    fc.assert(
      fc.property(pairs, ([, first, second]) => {
        expect(fillingsAgree(ours, first, second)).toBe(true);
        const shape = (messages: readonly string[]) =>
          clusterFailures(asFailures(messages)).clusters.map(
            ({ sampleMessage: _s, ...rest }) => rest,
          );
        expect(shape(second)).toEqual(shape(first));
      }),
      {
        ...params,
        examples: [
          // A hex run that is all digits but one letter, and a path ending in :line:col.
          [
            [
              [5],
              ['Error: commit 1aaaaa not found in src/a.ts:1:2'],
              ['Error: commit 9f00000000 not found in /x/y.ts:30:4'],
            ],
          ],
          // Found by this suite: a relative path whose first segment is `-` was cut in two.
          [
            [
              [3],
              ['Error: ENOENT: no such file or directory, open -/a.json'],
              ['Error: ENOENT: no such file or directory, open ./a/a.mjs'],
            ],
          ],
        ],
      },
    );
  });
});

describe('CLUSTER-2: two different causes never share a signature', () => {
  it('keeps every template apart, whatever fills it', () => {
    fc.assert(
      fc.property(pairs, ([indices, first]) => {
        for (let left = 0; left < indices.length; left += 1) {
          for (let right = 0; right < indices.length; right += 1) {
            if (indices[left] === indices[right]) continue;
            expect(ours(first[left] as string)).not.toBe(ours(first[right] as string));
          }
        }
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes CLUSTER-1 for a signer that only lower-cases the message', () => {
    const naive = (message: string) => message.toLowerCase();
    const result = fc.check(
      fc.property(pairs, ([, first, second]) => fillingsAgree(naive, first, second)),
      params,
    );
    expect(result.failed).toBe(true);
  });

  it('refutes CLUSTER-2 for a signer that empties every quoted string', () => {
    const greedy = (message: string) => ours(message.replace(/'[^']*'/gu, "''"));
    expect(greedy(String(TEMPLATES[6]?.[0]))).toBe(greedy(String(TEMPLATES[7]?.[0])));
  });
});
