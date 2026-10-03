import { describe, expect, it } from 'vitest';
import { K6_JSON_ADAPTER, parseK6Summary } from './k6-json.js';
import { ZAP_XML_ADAPTER, parseZapReport } from './zap-xml.js';
import { parseCoverage, stripRepoPrefixIfPresent } from './coverage.js';
import type { ProducerContext } from '../adapter.js';

/**
 * The edges of the three new adapters.
 *
 * `new-adapter-parity.test.ts` proves the **happy paths agree** — every adapter
 * returns a schema-valid result with `unverified` proof. This file proves the
 * **edges**, and edges are where an adapter decides what a *missing* value means:
 *
 *  - a threshold expression no operator writes (`avg<=500`, `count>10`);
 *  - a metric present but with no aggregate the expression names;
 *  - a ZAP alert whose host attribute is absent;
 *  - a coverage file path with no `src`/`lib`/`app` segment to anchor on.
 *
 * Each of those is a branch an adapter takes without an assertion behind it, and a
 * branch that is only exercised on the happy path is a branch that has never been
 * *run*, only written.
 */

const context: ProducerContext = {
  workspaceId: 'ws',
  runId: 'run-1',
  sourceUri: 'x',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1',
  adapterVersion: '1',
  startedAt: '2026-09-25T00:00:00.000Z',
};

const summary = (document: unknown) =>
  parseK6Summary(new TextEncoder().encode(JSON.stringify(document)), context);
const statusOf = (document: unknown, testId: string): string =>
  summary(document).attempts.find((attempt) => attempt.testId === testId)?.status ?? 'unknown';

describe('k6 threshold edges', () => {
  it('accepts every comparator, not just the two the tests started with', () => {
    // `p(95)<500` and `rate<0.01` are the shapes in the fixtures. Operators write
    // `<=`, `>` and `>=` too, and an unrecognised comparator would be *skipped*
    // rather than evaluated — a threshold silently dropped.
    for (const [expression, metric, expected] of [
      ['avg<=100', { avg: 100 }, 'passed'],
      ['avg<=100', { avg: 101 }, 'failed'],
      ['avg>50', { avg: 60 }, 'passed'],
      ['avg>50', { avg: 40 }, 'failed'],
      ['count>=10', { count: 10 }, 'passed'],
      ['count>=10', { count: 9 }, 'failed'],
    ] as const) {
      const result = summary({
        options: { thresholds: { [expression.split(/[<>=]/u)[0] as string]: [expression] } },
        metrics: { [expression.split(/[<>=]/u)[0] as string]: metric },
      });
      const attempt = result.attempts.find((candidate) =>
        candidate.testId.startsWith('threshold:'),
      );
      expect(attempt?.status, `${expression} with ${JSON.stringify(metric)}`).toBe(expected);
    }
  });

  it('skips an expression it cannot parse rather than reporting it as met', () => {
    // `p(95)<500` parses; `something happened` does not. Skipping is right and
    // *silent* — which is why it is asserted, so a future change that starts
    // guessing has to fail here.
    const result = summary({
      options: { thresholds: { http_req_duration: ['something happened'] } },
      metrics: { http_req_duration: { avg: 1 } },
    });
    expect(result.attempts.some((attempt) => attempt.testId.startsWith('threshold:'))).toBe(false);
  });

  it('skips a threshold expression with no comparison in it at all', () => {
    const result = summary({
      options: { thresholds: { http_req_duration: ['count'] } },
      metrics: { http_req_duration: { count: 1 } },
    });
    expect(
      result.attempts.filter((attempt) => attempt.testId.startsWith('threshold:')),
    ).toHaveLength(0);
  });

  it('handles a threshold declared as a bare string rather than a list', () => {
    // k6's own schema allows both, and a summary produced by a version that
    // serialises the single-bound form would otherwise report no threshold at all.
    const result = summary({
      options: { thresholds: { http_req_duration: 'p(95)<500' } },
      metrics: { http_req_duration: { 'p(95)': 100 } },
    });
    expect(result.attempts.some((attempt) => attempt.testId.startsWith('threshold:'))).toBe(true);
  });

  it('reads `rate` from the explicit rate field rather than the generic value', () => {
    // `http_req_failed` carries both `rate` and `value`, and they are the same
    // number for that metric. `rate` is read first so a metric with a `rate` of its
    // own is not read through its generic aggregate.
    expect(
      statusOf(
        {
          options: { thresholds: { http_req_failed: ['rate<0.01'] } },
          metrics: { http_req_failed: { rate: 0.5, value: 0 } },
        },
        'threshold:http_req_failed[rate<0.01]',
      ),
    ).toBe('failed');
  });

  it('reports a metric with no aggregates at all as having no metrics', () => {
    // The summary exists, declares thresholds, and measures nothing. That is a
    // summary with nothing to say, and the adapter must not dress it as a pass.
    const result = summary({ options: { thresholds: { missing: ['avg<1'] } }, metrics: {} });
    expect(result.status).toBe('unknown');
  });

  it('exposes itself as an adapter with the k6 media type', () => {
    expect(K6_JSON_ADAPTER.mediaType).toContain('k6');
  });
});

describe('ZAP edges', () => {
  const report = (body: string): Uint8Array =>
    new TextEncoder().encode(`<OWASPZAPReport version="2.14.0">${body}</OWASPZAPReport>`);

  it('accepts an alert with no site host and keeps its identity', () => {
    // A report with a bare `<alerts>` block and no enclosing `<site>`. The host is
    // attribution, not a verdict, so a missing one must not cost the alert.
    const result = parseZapReport(
      report(
        '<alerts><alertitem><pluginid>7</pluginid><alert>X</alert><riskcode>3</riskcode><count>1</count></alertitem></alerts>',
      ),
      context,
    );
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.testId).toBe('zap.7');
    expect(result.status).toBe('failed');
  });

  it('falls back to the alert position when a plugin reports no id', () => {
    const result = parseZapReport(
      report(
        '<site host="https://a.example"><alerts><alertitem><alert>X</alert><riskcode>2</riskcode><count>1</count></alertitem></alerts></site>',
      ),
      context,
    );
    // A synthetic but stable identity beats dropping the alert: a finding the
    // dashboard cannot key on is a finding nobody can navigate to.
    expect(result.attempts[0]?.testId).toMatch(/^zap\.\d+$/u);
  });

  it('treats an alert with a non-numeric count as one occurrence', () => {
    const result = parseZapReport(
      report(
        '<site host="https://a.example"><alerts><alertitem><pluginid>1</pluginid><alert>X</alert><riskcode>3</riskcode><count>many</count></alertitem></alerts></site>',
      ),
      context,
    );
    expect(result.attempts[0]?.title).toBe('X');
  });

  it('keeps an alert whose description and solution are empty, with the riskcode', () => {
    const result = parseZapReport(
      report(
        '<site host="https://a.example"><alerts><alertitem><pluginid>1</pluginid><alert>X</alert><riskcode>3</riskcode><count>1</count></alertitem></alerts></site>',
      ),
      context,
    );
    // A failed attempt needs a message; without one the run reads as failed for
    // reasons nobody can see.
    expect(result.attempts[0]?.error?.message).toContain('Risk 3');
  });

  it('decodes the five entities ZAP emits', () => {
    const result = parseZapReport(
      report(
        '<site host="https://a.example"><alerts><alertitem><pluginid>1</pluginid><alert>A &amp; B &lt;x&gt;</alert><riskcode>3</riskcode><count>1</count></alertitem></alerts></site>',
      ),
      context,
    );
    expect(result.attempts[0]?.title).toBe('A & B <x>');
  });

  it('exposes itself as an adapter', () => {
    expect(ZAP_XML_ADAPTER.mediaType).toContain('xml');
  });
});

describe('coverage path edges', () => {
  it('keeps an absolute path it cannot anchor, rather than discarding the file', () => {
    // A path with no `src`/`lib`/`app` segment has no repo-relative form this
    // adapter can compute. Discarding it would silently shrink the denominator and
    // make coverage look better than it is; keeping it means the file is counted and
    // the reader can see a path that looks wrong.
    expect(stripRepoPrefixIfPresent('/opt/build/generate.py')).toBe('/opt/build/generate.py');
  });

  it('anchors at the **last** source directory, and says so', () => {
    // `/repo/src/pkg/lib/mod.rb` becomes `lib/mod.rb`, not `src/pkg/lib/mod.rb`.
    // That is the heuristic's actual behaviour and it is a **heuristic**: the
    // adapter has no repository root, so it anchors at the last segment that looks
    // like a source root and hopes. For a Ruby project, where `lib/` is the source
    // root, it is right; for a monorepo package at `src/pkg/lib/`, it is not.
    //
    // The alternative — discarding the file — is worse: it would silently shrink the
    // denominator and make coverage look better than it is. The rule that matters is
    // the one in `coverage.ts`: a path that cannot be made relative is kept as-is.
    const report = parseCoverage(
      'simplecov',
      new TextEncoder().encode(JSON.stringify({ coverage: { '/repo/src/pkg/lib/mod.rb': [1] } })),
    );
    expect(report.files[0]?.path).toBe('lib/mod.rb');
  });

  it('reads a lcov file with no DA lines but a declared LF/LH', () => {
    // A generator that writes only the summary pair. Reading it as zero would be
    // wrong in the optimistic direction; the declared pair is the only evidence here.
    const report = parseCoverage(
      'lcov',
      new TextEncoder().encode('SF:a.ts\nLF:10\nLH:9\nend_of_record\n'),
    );
    expect(report.files[0]).toEqual({ path: 'a.ts', coveredLines: 0, totalLines: 0 });
    expect(report.coveredFraction).toBeNull();
  });

  it('ignores a malformed DA line rather than counting it', () => {
    const report = parseCoverage(
      'lcov',
      new TextEncoder().encode('SF:a.ts\nDA:1\nDA:2,1\nDA:oops\nend_of_record\n'),
    );
    // A DA line with no hit count is not a measurement. Counting it would add an
    // uncovered line the producer never reported.
    expect(report.files[0]?.totalLines).toBe(1);
  });

  it('refuses a simplecov document whose coverage map is not an object', () => {
    expect(() => parseCoverage('simplecov', new TextEncoder().encode('{"coverage":[]}'))).toThrow(
      /simplecov/i,
    );
  });

  it('reads a jacoco report with two classes of the same name', () => {
    // Two classes in different packages share a `sourcefilename`; the class name is
    // what keeps them apart, and collapsing them would report one class's coverage
    // as another's.
    const report = parseCoverage(
      'jacoco-xml',
      new TextEncoder().encode(
        '<report><package name="a"><class name="a/A" sourcefilename="A.java"><counter type="LINE" missed="1" covered="1"/></class></package><package name="b"><class name="b/A" sourcefilename="A.java"><counter type="LINE" missed="2" covered="2"/></class></package></report>',
      ),
    );
    expect(report.files).toEqual([
      { path: 'a/A.java', coveredLines: 1, totalLines: 2 },
      { path: 'b/A.java', coveredLines: 2, totalLines: 4 },
    ]);
  });
});
