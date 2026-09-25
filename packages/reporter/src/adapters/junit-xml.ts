import { SaxesParser } from 'saxes';
import { CanonicalRunResultSchema, type CanonicalRunResult } from '@automate/shared-contracts';
import type { ProducerAdapter } from '../adapter.js';

interface TestCase {
  name: string;
  classname?: string;
  time?: number;
  status: string;
  message?: string;
}

function statusFrom(raw: string | undefined, children: Set<string>): CanonicalRunResult['status'] {
  if (children.has('failure')) return 'failed';
  if (children.has('error')) return 'failed';
  if (children.has('skipped')) return 'skipped';
  if (raw === 'passed') return 'passed';
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
          time: attributes.time ? Number(attributes.time) * 1000 : undefined,
          status: 'unknown',
        };
        currentText = '';
        currentChildren.clear();
      } else if (tag.name === 'failure' || tag.name === 'error' || tag.name === 'skipped') {
        currentChildren.add(tag.name);
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
        current.status = statusFrom(undefined, currentChildren);
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
      specPath: 'unknown.spec.ts',
      title: testCase.name,
      suite: testCase.classname,
      status: testCase.status,
      rawStatus: testCase.status,
      startedAt: context.startedAt,
      finishedAt: context.finishedAt,
      durationMs: Number.isFinite(testCase.time) ? testCase.time : undefined,
      error: testCase.message ? { message: testCase.message } : undefined,
      evidence: [],
      flakiness: 'unknown' as const,
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
