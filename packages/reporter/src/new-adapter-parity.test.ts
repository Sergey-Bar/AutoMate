import { describe, expect, it } from 'vitest';

import { K6_JSON_ADAPTER } from './adapters/k6-json.js';
import { ZAP_XML_ADAPTER } from './adapters/zap-xml.js';
import { junitXmlAdapter } from './adapters/junit-xml.js';
import { playwrightJsonAdapter } from './adapters/playwright-json.js';
import { COVERAGE_ADAPTERS } from './adapters/coverage.js';
import { INGESTED_PRODUCERS } from './producer-status.js';
import { CanonicalRunResultSchema } from '@automate/shared-contracts';
import type { ProducerAdapter, ProducerContext } from './adapter.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  projectId: 'project-1',
  sourceUri: 'artifact://run-1/report',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-10-02T00:00:00.000Z',
  finishedAt: '2026-10-02T00:05:00.000Z',
};

/** Every adapter that produces a run result, and one document each. */
const RESULT_ADAPTERS: ReadonlyArray<readonly [string, ProducerAdapter, Uint8Array]> = [
  [
    'junit',
    junitXmlAdapter,
    new TextEncoder().encode(
      '<testsuite><testcase classname="s" file="t/a.ts" name="a" status="passed"/></testsuite>',
    ),
  ],
  [
    'playwright',
    playwrightJsonAdapter,
    new TextEncoder().encode(
      JSON.stringify({
        suites: [
          {
            title: 's',
            file: 't/a.ts',
            tests: [{ title: 'a', status: 'passed', results: [{ status: 'passed' }] }],
          },
        ],
      }),
    ),
  ],
  [
    'k6',
    K6_JSON_ADAPTER,
    new TextEncoder().encode(
      JSON.stringify({ metrics: { checks: { passes: 1, fails: 0, value: 1 } } }),
    ),
  ],
  [
    'zap',
    ZAP_XML_ADAPTER,
    new TextEncoder().encode(
      '<OWASPZAPReport version="2.14.0"><site name="a" host="https://a.example"><alerts/></site></OWASPZAPReport>',
    ),
  ],
];

describe('every result adapter obeys the same contract', () => {
  // This is the property `adapter-parity.test.ts` was written for, widened: it used
  // to cover Playwright and JUnit, and adding two adapters that did not go through
  // the same checks would have left the guarantee describing half the package.
  for (const [name, adapter, document] of RESULT_ADAPTERS) {
    describe(name, () => {
      const parsed = () => adapter.parse(document, context);

      it('returns a schema-valid canonical result', () => {
        expect(CanonicalRunResultSchema.safeParse(parsed()).success).toBe(true);
      });

      it('records its own producer name, so a row says who wrote it', () => {
        expect(parsed().provenance.producer).toBe(name);
      });

      it('never overstates proof: parsing a report is not verifying a run', () => {
        expect(parsed().proof.state).toBe('unverified');
        expect(parsed().proof.digest).toBe(context.sourceDigest);
      });

      it('carries the cohort from the context, never from the document', () => {
        expect(parsed().provenance.sourceUri).toBe(context.sourceUri);
        expect(parsed().identity).toEqual({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
        });
      });

      it('numbers every attempt from 1 within its own test', () => {
        for (const attempt of parsed().attempts ?? []) {
          expect(attempt.index, `${name}: ${attempt.testId}`).toBeGreaterThanOrEqual(1);
        }
      });
    });
  }

  it('covers every producer in the status registry', () => {
    // A producer in `INGESTED_PRODUCERS` with no adapter here is one that reached
    // the registry without reaching the package — the shape the registry's
    // `satisfies` guard cannot see, because the guard is on the *tables*, not on
    // the adapters.
    expect(RESULT_ADAPTERS.map(([name]) => name).sort()).toEqual(
      [...INGESTED_PRODUCERS].filter((producer) => producer !== 'legacy').sort(),
    );
  });
});

describe('coverage is not a run result, and the registry says so', () => {
  it('exposes six formats, none of which implements ProducerAdapter', () => {
    // The type is the assertion: `CoverageAdapter.parse` returns a `CoverageReport`,
    // which has no `status` and no `attempts`. A coverage document offered to a
    // result adapter parses a percentage as a suite and reports a test that does
    // not exist.
    for (const adapter of Object.values(COVERAGE_ADAPTERS)) {
      expect('status' in adapter).toBe(false);
      expect(adapter.format).toBeTypeOf('string');
    }
  });

  it('names a media type for each format, so a uploader can route by content type', () => {
    for (const adapter of Object.values(COVERAGE_ADAPTERS)) {
      expect(adapter.mediaTypes.length, adapter.format).toBeGreaterThan(0);
    }
  });
});

describe('the JUnit dialects six ecosystems write all parse under one adapter', () => {
  /**
   * R4: one adapter, one unsupported path — not six adapters.
   *
   * Every ecosystem writes "JUnit XML", and every one of them writes it slightly
   * differently. Six adapters would mean six status mappings, six proof shapes and
   * six ways for the same test to be reported; one adapter with a dialect fixture
   * per producer means the divergences are *asserted* rather than discovered.
   */
  const dialects: ReadonlyArray<{ dialect: string; document: string; expectPassed: number }> = [
    {
      dialect: 'jest',
      document:
        '<testsuites><testsuite name="s" tests="1"><testcase classname="S" name="adds" file="src/a.ts" time="0.01"/></testsuite></testsuites>',
      expectPassed: 1,
    },
    {
      dialect: 'pytest',
      document:
        '<testsuites><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="1"><testcase classname="tests.test_a" name="test_adds" file="tests/test_a.py" time="0.01"/></testsuite></testsuites>',
      expectPassed: 1,
    },
    {
      dialect: 'rspec',
      document:
        '<testsuite name="rspec" tests="1" failures="0"><testcase classname="S" file="./spec/a_spec.rb" name="test adds" time="0.01"/></testsuite>',
      expectPassed: 1,
    },
    {
      dialect: 'phpunit',
      document:
        '<testsuites><testsuite name="S" tests="1"><testcase classname="S::testAdd" name="testAdd" file="tests/ATest.php" assertions="1" time="0.01"/></testsuite></testsuites>',
      expectPassed: 1,
    },
    {
      dialect: 'gradle',
      // Gradle nests a `system-out` and uses `<skipped/>` as a child element.
      document:
        '<testsuite name="com.example.S" tests="1" skipped="0" failures="0"><testcase name="adds" classname="com.example.S" time="0.01"><system-out/></testcase></testsuite>',
      expectPassed: 1,
    },
    {
      dialect: 'maven-surefire',
      // Surefire writes the classname and the file into different attributes.
      document:
        '<testsuite name="com.example.S" time="0.01" tests="1" errors="0" skipped="0" failures="0"><testcase name="adds" classname="com.example.S" time="0.01"/></testsuite>',
      expectPassed: 1,
    },
  ];

  for (const { dialect, document, expectPassed } of dialects) {
    it(`reads a ${dialect} report as ${expectPassed} passing attempt`, () => {
      const result = junitXmlAdapter.parse(new TextEncoder().encode(document), context);
      expect(result.status).toBe('passed');
      expect(result.attempts ?? []).toHaveLength(expectPassed);
      // The producer is JUnit for all six. The *dialect* is not a producer: it is
      // a document shape the same parser already reads, and labelling it as a
      // producer would multiply the status tables for no gain.
      expect(result.provenance.producer).toBe('junit');
    });
  }

  it('reads a nested `<suites>` report, which is what six of the six emit', () => {
    // `<testsuites>` wrapping two `<testsuite>`s is the shape every dialect
    // actually writes. An adapter that only matched a bare `<testsuite>` would
    // ingest zero tests from every report in production.
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuites>' +
          '<testsuite name="a"><testcase classname="A" name="x" file="a.ts"/></testsuite>' +
          '<testsuite name="b"><testcase classname="B" name="y" file="b.ts"/></testsuite>' +
          '</testsuites>',
      ),
      context,
    );
    expect(result.attempts ?? []).toHaveLength(2);
  });

  it('reads a failure element in any dialect', () => {
    // `<failure>` is universal, but its *text* is not: Surefire puts a stack trace
    // in it, pytest puts an assertion message, and an empty `<failure/>` carries
    // only the declaration. All three have to produce a failed attempt.
    for (const body of [
      '<failure message="boom">trace</failure>',
      '<failure>boom</failure>',
      '<failure/>',
    ]) {
      const result = junitXmlAdapter.parse(
        new TextEncoder().encode(
          `<testsuite><testcase classname="S" name="x" file="a.ts">${body}</testcase></testsuite>`,
        ),
        context,
      );
      expect(result.status, body).toBe('failed');
    }
  });
});
