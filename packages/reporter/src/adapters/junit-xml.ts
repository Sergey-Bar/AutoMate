import { SaxesParser } from 'saxes';
import { CanonicalRunResultSchema, type CanonicalRunResult } from '@automate/shared-contracts';
import type { ProducerAdapter } from '../adapter.js';

interface TestCase {
  name: string;
  classname?: string;
  file?: string;
  time?: number;
  status: string;
  flakiness: 'unknown' | 'observed';
  declaredStatus?: string;
  message?: string;
}

/**
 * JUnit test-case elements that carry outcome evidence.
 *
 * `flakyFailure` and `rerunFailure` are the JUnit way of saying "this test
 * failed on an earlier attempt and passed on a later one", so their presence is
 * the only honest source for `flakiness: 'observed'`.
 */
const OUTCOME_CHILDREN = new Set([
  'failure',
  'error',
  'skipped',
  'flakyfailure',
  'rerunfailure',
  'rerunerror',
]);

/**
 * Maps JUnit evidence to a canonical status.
 *
 * A `<testcase>` with no `status` attribute and no outcome child declares
 * nothing, so it resolves to `unknown` — not `passed`. The previous
 * `return 'passed'` turned an attribute-less testcase into a product pass, and
 * the run-level aggregation below then reported the whole run green.
 */
function statusFrom(
  declaredStatus: string | undefined,
  children: Set<string>,
): CanonicalRunResult['status'] {
  if (children.has('failure') || children.has('error') || children.has('rerunerror'))
    return 'failed';
  if (children.has('skipped')) return 'skipped';
  // Retry evidence outranks a declared status: a `<testcase status="passed">`
  // that also carries a `rerunFailure` is a flaky pass, not a clean one.
  if (children.has('flakyfailure') || children.has('rerunfailure')) return 'flaky';
  if (declaredStatus !== undefined) {
    if (declaredStatus === 'passed') return 'passed';
    if (declaredStatus === 'failed') return 'failed';
    if (declaredStatus === 'skipped') return 'skipped';
    if (declaredStatus === 'flaky') return 'flaky';
    if (declaredStatus === 'timedOut') return 'timedOut';
    return 'unknown';
  }
  return 'unknown';
}

export const junitXmlAdapter: ProducerAdapter = {
  mediaType: 'application/xml',
  parse(input, context) {
    const parser = new SaxesParser({ xmlns: false });
    const testCases: TestCase[] = [];
    let current: TestCase | undefined;
    let currentText = '';
    const currentChildren = new Set<string>();
    parser.on('opentag', (tag) => {
      if (tag.name === 'testcase') {
        const attributes = tag.attributes as Record<string, string>;
        current = {
          name: attributes.name ?? 'unnamed test',
          classname: attributes.classname,
          file: attributes.file,
          time: attributes.time ? Number(attributes.time) * 1000 : undefined,
          status: 'unknown',
          flakiness: 'unknown',
          declaredStatus: attributes.status,
        };
        currentText = '';
        currentChildren.clear();
      } else if (OUTCOME_CHILDREN.has(tag.name.toLowerCase())) {
        currentChildren.add(tag.name.toLowerCase());
      }
    });
    parser.on('text', (text) => {
      currentText += text;
    });
    parser.on('cdata', (text) => {
      currentText += text;
    });
    parser.on('closetag', (tag) => {
      if (tag.name === 'testcase' && current) {
        current.status = statusFrom(current.declaredStatus, currentChildren);
        // `flakyFailure` / `rerunFailure` are the only JUnit evidence that a
        // test needed more than one attempt, so flakiness stays `unknown`
        // without them.
        current.flakiness =
          current.status === 'flaky' ||
          currentChildren.has('flakyfailure') ||
          currentChildren.has('rerunfailure')
            ? 'observed'
            : 'unknown';
        current.message = currentText.trim() || undefined;
        testCases.push(current);
        current = undefined;
        currentText = '';
        currentChildren.clear();
      }
    });
    parser.write(new TextDecoder().decode(input)).close();
    if (testCases.length === 0) throw new Error('JUnit report contains no test cases');
    const attempts = testCases.map((testCase, index) => ({
      index: index + 1,
      testId: `${testCase.classname ?? 'suite'}:${testCase.name}`,
      specPath: testCase.file ?? 'unknown.spec.ts',
      title: testCase.name,
      suite: testCase.classname,
      status: testCase.status,
      rawStatus: testCase.status,
      startedAt: context.startedAt,
      finishedAt: context.finishedAt,
      durationMs: Number.isFinite(testCase.time) ? testCase.time : undefined,
      error: testCase.message ? { message: testCase.message } : undefined,
      evidence: [],
      flakiness: testCase.flakiness,
    }));
    const hasFailure = attempts.some(
      (attempt) => attempt.status === 'failed' || attempt.status === 'timedOut',
    );
    const hasUnknown = attempts.some((attempt) => attempt.status === 'unknown');
    const allSkipped = attempts.every((attempt) => attempt.status === 'skipped');
    const status = hasFailure
      ? 'failed'
      : hasUnknown
        ? 'unknown'
        : allSkipped
          ? 'skipped'
          : 'passed';
    return CanonicalRunResultSchema.parse({
      contractVersion: '2',
      identity: {
        runId: context.runId,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
      },
      status,
      startedAt: context.startedAt,
      finishedAt: context.finishedAt,
      attempts,
      evidence: [],
      provenance: {
        producer: 'junit',
        producerVersion: context.producerVersion,
        adapterVersion: context.adapterVersion,
        sourceDigest: context.sourceDigest,
        sourceUri: context.sourceUri,
      },
      retention: { class: 'standard' },
      proof: { state: 'unverified', digest: context.sourceDigest, verifier: 'junit-adapter' },
      completeness: {
        state: hasUnknown ? 'unknown' : 'complete',
        missingShards: [],
        duplicateShards: [],
      },
      raw: {},
    });
  },
};
