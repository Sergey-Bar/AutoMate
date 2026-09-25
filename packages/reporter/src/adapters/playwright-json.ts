import { createHash } from 'node:crypto';
import { CanonicalRunResultSchema, type CanonicalRunResult } from '@automate/shared-contracts';
import type { ProducerAdapter } from '../adapter.js';

interface PlaywrightAttachment {
  name?: string;
  contentType?: string;
  body?: string;
}
interface PlaywrightAttempt {
  status?: string;
  duration?: number;
  error?: { message?: string };
  attachments?: PlaywrightAttachment[];
  startTime?: string;
}
interface PlaywrightTest {
  title?: string;
  path?: string[];
  projectName?: string;
  results?: PlaywrightAttempt[];
  status?: string;
}
interface PlaywrightSpec {
  title?: string;
  file?: string;
  tests?: PlaywrightTest[];
  suites?: PlaywrightSpec[];
}
interface PlaywrightReport {
  suites?: PlaywrightSpec[];
}

function collectSpecs(suites: PlaywrightSpec[] | undefined, output: PlaywrightSpec[] = []) {
  for (const suite of suites ?? []) {
    if (suite.file && suite.title) output.push(suite);
    collectSpecs(suite.suites, output);
  }
  return output;
}

function mapStatus(status: string | undefined): CanonicalRunResult['status'] {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'timedOut':
      return 'timedOut';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

function evidenceFor(
  attachments: PlaywrightAttachment[] | undefined,
  runId: string,
  testIndex: number,
  attemptIndex: number,
) {
  return (attachments ?? []).flatMap((attachment, attachmentIndex) => {
    if (!attachment.body || !attachment.name) return [];
    const bytes = Buffer.from(attachment.body, 'base64');
    return [
      {
        uri: `artifact://${runId}/${testIndex}/${attemptIndex}/${attachmentIndex}/${attachment.name}`,
        mediaType: attachment.contentType ?? 'application/octet-stream',
        byteSize: bytes.byteLength,
        digest: createHash('sha256').update(bytes).digest('hex'),
      },
    ];
  });
}

export const playwrightJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.playwright+json',
  parse(input, context) {
    const report = JSON.parse(new TextDecoder().decode(input)) as PlaywrightReport;
    const specs = collectSpecs(report.suites);
    const attempts = specs.flatMap((spec, testIndex) => {
      const tests = spec.tests ?? [];
      return tests.flatMap((test) => {
        const results = test.results?.length ? test.results : [{ status: test.status }];
        return results.map((attempt, attemptIndex) => ({
          index: attemptIndex + 1,
          testId: `${spec.file}:${test.title ?? testIndex}`,
          specPath: spec.file,
          title: test.title ?? spec.title,
          suite: spec.title,
          status: mapStatus(attempt.status),
          rawStatus: attempt.status ?? 'unknown',
          startedAt: attempt.startTime ?? context.startedAt,
          finishedAt: context.finishedAt,
          durationMs: attempt.duration,
          error: attempt.error?.message ? { message: attempt.error.message } : undefined,
          evidence: evidenceFor(attempt.attachments, context.runId, testIndex, attemptIndex),
          flakiness: 'unknown' as const,
        }));
      });
    });
    if (attempts.length === 0) throw new Error('Playwright report contains no test attempts');
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
      evidence: attempts.flatMap((attempt) => attempt.evidence),
      provenance: {
        producer: 'playwright',
        producerVersion: context.producerVersion,
        adapterVersion: context.adapterVersion,
        sourceDigest: context.sourceDigest,
        sourceUri: context.sourceUri,
        project: context.projectId,
      },
      retention: { class: 'standard' },
      proof: { state: 'unverified', digest: context.sourceDigest, verifier: 'playwright-adapter' },
      completeness: {
        state: hasUnknown ? 'unknown' : 'complete',
        missingShards: [],
        duplicateShards: [],
      },
      raw: {},
    });
  },
};
