import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CanonicalRunResultSchema } from '@automate/shared-contracts';
import type { ProducerAdapter, ProducerContext } from './adapter.js';
import { junitXmlAdapter } from './adapters/junit-xml.js';
import { K6_JSON_ADAPTER } from './adapters/k6-json.js';
import { legacyUploadAdapter } from './adapters/legacy-upload.js';
import { playwrightJsonAdapter } from './adapters/playwright-json.js';
import { ZAP_XML_ADAPTER } from './adapters/zap-xml.js';

/**
 * Property suite for invariants REPORT-1 .. REPORT-4 in `docs/quality/property-invariants.json`.
 *
 * Fixed seed and `numRuns`. Generated JUnit documents are built from a model, so the expected
 * counts are known independently of the parser under test.
 */
const SEED = 20261022;
const params = { seed: SEED, numRuns: 200 } as const;

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'artifact://run-1/results.xml',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-09-25T00:00:00.000Z',
};

type Outcome = 'passed' | 'failed' | 'error' | 'skipped' | 'flaky';
interface Case {
  classname: string;
  name: string;
  outcome: Outcome;
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

function body(outcome: Outcome): string {
  switch (outcome) {
    case 'passed':
      return '';
    case 'failed':
      return '<failure message="boom">stack</failure>';
    case 'error':
      return '<error message="boom">stack</error>';
    case 'skipped':
      return '<skipped/>';
    case 'flaky':
      return '<rerunFailure message="first attempt">stack</rerunFailure>';
  }
}

function toXml(cases: readonly Case[]): string {
  const rows = cases.map(
    (item) =>
      `<testcase classname="${escapeXml(item.classname)}" name="${escapeXml(item.name)}">${body(item.outcome)}</testcase>`,
  );
  return `<testsuite>${rows.join('')}</testsuite>`;
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Printable ASCII, at least one visible character: XML-safe once escaped. */
const wordArb = fc
  .string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 12 })
  .filter((value) => value.trim().length > 0);
const caseArb: fc.Arbitrary<Case> = fc.record({
  classname: fc.constantFrom('a.A', 'b.B', 'c.C'),
  name: wordArb,
  outcome: fc.constantFrom<Outcome>('passed', 'failed', 'error', 'skipped', 'flaky'),
});
const casesArb = fc.array(caseArb, { minLength: 1, maxLength: 25 });

function tally(statuses: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

describe('REPORT-1: counts add up after parse -> normalise', () => {
  it('passed + failed + skipped + flaky equals the number of test cases, and each matches the model', () => {
    fc.assert(
      fc.property(casesArb, (cases) => {
        const result = junitXmlAdapter.parse(encode(toXml(cases)), context);
        const counts = tally(result.attempts.map((attempt) => attempt.status));
        const expected = tally(
          cases.map((item) => (item.outcome === 'error' ? 'failed' : item.outcome)),
        );

        expect(result.attempts).toHaveLength(cases.length);
        expect(counts).toEqual(expected);
        const classified =
          (counts['passed'] ?? 0) +
          (counts['failed'] ?? 0) +
          (counts['skipped'] ?? 0) +
          (counts['flaky'] ?? 0);
        expect(classified).toBe(cases.length);
      }),
      {
        ...params,
        // A retry is several testcases with one id; the ordinal must be per test.
        examples: [
          [
            [
              { classname: 'a.A', name: 't', outcome: 'flaky' },
              { classname: 'a.A', name: 't', outcome: 'passed' },
            ],
          ],
        ],
      },
    );
  });

  it('attempt indexes are 1..n per test id with no gap and no repeat', () => {
    fc.assert(
      fc.property(casesArb, (cases) => {
        const result = junitXmlAdapter.parse(encode(toXml(cases)), context);
        const byTest = new Map<string, number[]>();
        for (const attempt of result.attempts) {
          byTest.set(attempt.testId, [...(byTest.get(attempt.testId) ?? []), attempt.index]);
        }
        for (const indexes of byTest.values()) {
          expect(indexes).toEqual(indexes.map((_, position) => position + 1));
        }
      }),
      params,
    );
  });
});

describe('REPORT-2: the run status is derived from the tests, never invented', () => {
  it('follows the ladder: failed > skipped-only > flaky > passed, and is complete', () => {
    fc.assert(
      fc.property(casesArb, (cases) => {
        const result = junitXmlAdapter.parse(encode(toXml(cases)), context);
        const outcomes = cases.map((item) => item.outcome);
        const expected = outcomes.some((o) => o === 'failed' || o === 'error')
          ? 'failed'
          : outcomes.every((o) => o === 'skipped')
            ? 'skipped'
            : outcomes.some((o) => o === 'flaky')
              ? 'flaky'
              : 'passed';
        expect(result.status).toBe(expected);
        expect(result.completeness.state).toBe('complete');
      }),
      params,
    );
  });

  it('a document cut short never reports a pass and never claims to be complete', () => {
    fc.assert(
      fc.property(
        casesArb,
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        (cases, at) => {
          const xml = toXml(cases);
          const cut = xml.slice(0, Math.floor(xml.length * at));
          let result;
          try {
            result = junitXmlAdapter.parse(encode(cut), context);
          } catch (error) {
            // Nothing recoverable: a classified refusal, not a verdict.
            expect(error).toBeInstanceOf(Error);
            return;
          }
          expect(result.completeness.state).toBe('unknown');
          expect(result.status).not.toBe('passed');
        },
      ),
      params,
    );
  });
});

describe('REPORT-3: parsing is total', () => {
  const adapters: ReadonlyArray<readonly [string, ProducerAdapter]> = [
    ['junit', junitXmlAdapter],
    ['playwright', playwrightJsonAdapter],
    ['k6', K6_JSON_ADAPTER],
    ['zap', ZAP_XML_ADAPTER],
    ['legacy-upload', legacyUploadAdapter],
  ];

  function assertTotal(adapter: ProducerAdapter, input: Uint8Array): void {
    let result;
    try {
      result = adapter.parse(input, context);
    } catch (error) {
      // The only acceptable failure is a classified one: a real Error with a message.
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message.length).toBeGreaterThan(0);
      return;
    }
    // And the only acceptable success is a result the contract accepts.
    expect(CanonicalRunResultSchema.safeParse(result).success).toBe(true);
  }

  it.each(adapters)(
    '%s: arbitrary bytes yield a valid result or a classified Error',
    (_name, adapter) => {
      fc.assert(
        fc.property(fc.uint8Array({ maxLength: 400 }), (bytes) => {
          assertTotal(adapter, bytes);
        }),
        { ...params, examples: [[new Uint8Array([])], [new Uint8Array([0xff, 0xfe, 0x3c])]] },
      );
    },
  );

  it.each(adapters)(
    '%s: arbitrary JSON-shaped input yields a valid result or a classified Error',
    (_name, adapter) => {
      fc.assert(
        fc.property(fc.json(), (json) => {
          assertTotal(adapter, encode(json));
        }),
        {
          ...params,
          // `null` entries and empty containers are what real reports contain.
          examples: [
            ['null'],
            ['{}'],
            ['[]'],
            ['{"suites":[null]}'],
            ['{"suites":[{"specs":null}]}'],
          ],
        },
      );
    },
  );

  it.each(adapters)(
    '%s: arbitrary markup yields a valid result or a classified Error',
    (_name, adapter) => {
      fc.assert(
        fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
          assertTotal(adapter, encode(text));
        }),
        { ...params, examples: [['<testsuite><testcase']] },
      );
    },
  );
});

describe('REPORT-4: a document with no test case is refused, not reported as a pass', () => {
  it('well-formed XML with no testcase is a classified error for any wrapper', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('testsuite', 'testsuites', 'root'),
        fc.array(wordArb, { maxLength: 5 }),
        (tag, words) => {
          const xml = `<${tag}>${words.map((word) => `<note>${escapeXml(word)}</note>`).join('')}</${tag}>`;
          expect(() => junitXmlAdapter.parse(encode(xml), context)).toThrow(/no test cases/);
        },
      ),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes a deliberately wrong claim ("an errored test is counted as passed")', () => {
    const outcome = fc.check(
      fc.property(casesArb, (cases) => {
        const result = junitXmlAdapter.parse(encode(toXml(cases)), context);
        const passed = result.attempts.filter((attempt) => attempt.status === 'passed').length;
        return passed === cases.filter((item) => item.outcome !== 'skipped').length;
      }),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
