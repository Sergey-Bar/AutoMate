import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RunDetailPage } from './run-detail.js';
import { makeApi, makePhaseEvent, makeRun, TEST_TIMESTAMP } from '../../test-utils.js';
import type { ApiClient, Run } from '../../lib/api.js';

const artifact = {
  id: 'artifact-1',
  runId: 'run-123',
  jobId: 'job-1',
  testId: null,
  kind: 'trace',
  name: 'trace.zip',
  contentType: 'application/zip',
  storageKey: 'runs/run-123/trace.zip',
  checksum: 'a'.repeat(64),
  sizeBytes: 1_024,
  createdAt: TEST_TIMESTAMP,
  expiresAt: null,
  legalHold: false,
  metadata: {},
};

const gate = {
  id: 'gate-1',
  runId: 'run-123',
  releaseId: 'release-1',
  policyId: 'policy-1',
  policyVersion: '1',
  policyHash: 'b'.repeat(64),
  status: 'failed' as const,
  decision: 'blocked' as const,
  reasons: ['browser tests failed'],
  evidenceRefs: ['run-123'],
  domainStatuses: {
    browser: 'failed' as const,
    api: 'not_configured' as const,
    mobile: 'not_configured' as const,
    performance: 'not_configured' as const,
    security: 'not_configured' as const,
    accessibility: 'not_configured' as const,
    other: 'not_configured' as const,
  },
  evaluatedAt: TEST_TIMESTAMP,
};

const passedRun = makeRun({
  id: 'run-123',
  projectId: 'automate',
  phase: 'complete',
  outcome: 'failed',
  startedAt: TEST_TIMESTAMP,
  completedAt: TEST_TIMESTAMP,
  finishedAt: TEST_TIMESTAMP,
  tests: [
    {
      id: 'test-result-1',
      testId: 'test-1',
      title: 'loads the command center',
      suite: 'smoke',
      file: 'e2e/smoke.spec.ts',
      status: 'failed',
      startedAt: TEST_TIMESTAMP,
      finishedAt: TEST_TIMESTAMP,
      durationMs: 250,
      error: { code: 'ASSERTION_FAILED', message: 'Expected command center' },
      attempts: [
        {
          attempt: 1,
          status: 'failed',
          startedAt: TEST_TIMESTAMP,
          finishedAt: TEST_TIMESTAMP,
          durationMs: 250,
          error: { code: 'ASSERTION_FAILED', message: 'Expected command center' },
          artifactIds: [],
          metadata: {},
        },
        {
          attempt: 2,
          status: 'passed',
          startedAt: TEST_TIMESTAMP,
          finishedAt: TEST_TIMESTAMP,
          durationMs: 200,
          error: null,
          artifactIds: [],
          metadata: {},
        },
      ],
      artifactIds: [],
      metadata: {},
    },
  ],
  summary: {
    total: 1,
    passed: 0,
    failed: 1,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: 500,
  },
  artifacts: [artifact],
  policyEvaluation: gate,
});

function detailApi(run: Run, overrides: Partial<ApiClient> = {}): ApiClient {
  return makeApi({
    getRun: vi.fn().mockResolvedValue(run),
    getRunArtifacts: vi.fn().mockResolvedValue(run.artifacts),
    getRunGate: vi.fn().mockResolvedValue(run.policyEvaluation),
    ...overrides,
  });
}

describe('RunDetailPage', () => {
  it('renders loading state initially', () => {
    const api = detailApi(passedRun, { getRun: vi.fn(() => new Promise<Run>(() => undefined)) });
    render(<RunDetailPage id="run-123" api={api} />);
    expect(screen.getByTestId('run-detail-loading')).toHaveTextContent('run-123');
  });

  it('renders not found and generic error states', async () => {
    const missing = detailApi(passedRun, {
      getRun: vi.fn().mockRejectedValue(new Error('Run not found (404)')),
    });
    const missingView = render(<RunDetailPage id="missing" api={missing} />);
    await waitFor(() => expect(screen.getByTestId('run-not-found')).toBeInTheDocument());
    missingView.unmount();

    const failed = detailApi(passedRun, {
      getRun: vi.fn().mockRejectedValue(new Error('Database unavailable')),
    });
    render(<RunDetailPage id="run-123" api={failed} />);
    await waitFor(() =>
      expect(screen.getByTestId('run-error')).toHaveTextContent('Database unavailable'),
    );
  });

  it('renders phase, outcome, attempts, artifacts, gate, and readiness evidence', async () => {
    const readiness = {
      releaseId: 'release-1',
      decision: 'blocked' as const,
      browser: 'failed' as const,
      domains: gate.domainStatuses,
      latestRunId: 'run-123',
      gate,
      evaluatedAt: TEST_TIMESTAMP,
    };
    const api = detailApi(passedRun, { getReleaseReadiness: vi.fn().mockResolvedValue(readiness) });
    render(<RunDetailPage id="run-123" api={api} />);

    await waitFor(() => expect(screen.getByTestId('run-detail-page')).toBeInTheDocument());
    expect(screen.getByTestId('run-phase')).toHaveTextContent('complete');
    expect(screen.getByTestId('run-status')).toHaveTextContent('FAILED');
    expect(screen.getByTestId('run-project')).toHaveTextContent('automate');
    expect(screen.getByTestId('run-total')).toHaveTextContent('1');
    expect(screen.getByTestId('test-test-result-1')).toHaveTextContent('loads the command center');
    expect(screen.getByTestId('test-error-test-result-1')).toHaveTextContent(
      'Expected command center',
    );
    expect(screen.getByRole('link', { name: 'trace.zip' })).toHaveAttribute(
      'href',
      '/api/v1/artifacts/artifact-1',
    );
    expect(screen.getByTestId('run-gate')).toHaveTextContent('browser tests failed');
    expect(screen.getByTestId('run-readiness')).toHaveTextContent('NOT_CONFIGURED');
  });

  it('shows explicit UNKNOWN values for missing evidence', async () => {
    const unknownRun = makeRun({ id: 'unknown', projectId: null, phase: 'queued' });
    render(<RunDetailPage id="unknown" api={detailApi(unknownRun)} />);
    await waitFor(() => expect(screen.getByTestId('run-detail-page')).toBeInTheDocument());
    expect(screen.getByTestId('run-project')).toHaveTextContent('UNKNOWN');
    expect(screen.getByTestId('run-duration')).toHaveTextContent('UNKNOWN');
    expect(screen.getByTestId('run-gate')).toHaveTextContent('UNKNOWN');
    expect(screen.getByText(/No events have been observed/iu)).toBeInTheDocument();
  });

  it('records live canonical events in the timeline', async () => {
    let emit: ((event: ReturnType<typeof makePhaseEvent>) => void) | undefined;
    const api = detailApi(passedRun, {
      subscribeToRunEvents: vi.fn((subscription) => {
        emit = subscription.onEvent;
        return () => undefined;
      }),
    });
    render(<RunDetailPage id="run-123" api={api} />);
    await waitFor(() => expect(screen.getByTestId('run-detail-page')).toBeInTheDocument());
    act(() => {
      emit?.(
        makePhaseEvent({ runId: 'run-123', sequence: 4, phase: 'complete', outcome: 'passed' }),
      );
    });
    await waitFor(() => expect(screen.getByText('run.phase_changed')).toBeInTheDocument());
  });

  it('cancels an active run and refetches authoritative state', async () => {
    const active = makeRun({ id: 'active', phase: 'running' });
    const cancelled = makeRun({ id: 'active', phase: 'cancelled', outcome: 'cancelled' });
    const api = detailApi(active, {
      getRun: vi.fn().mockResolvedValueOnce(active).mockResolvedValue(cancelled),
      cancelRun: vi.fn().mockResolvedValue(cancelled),
    });
    render(<RunDetailPage id="active" api={api} />);
    await waitFor(() => expect(screen.getByTestId('cancel-run')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('cancel-run'));
    await waitFor(() => expect(api.cancelRun).toHaveBeenCalledWith('active'));
    await waitFor(() => expect(screen.getByTestId('run-phase')).toHaveTextContent('cancelled'));
  });

  it('retries a failed run and links to the new canonical run', async () => {
    const failed = makeRun({ id: 'failed', phase: 'complete', outcome: 'failed' });
    const retried = makeRun({
      id: 'retry-run',
      phase: 'queued',
      attempt: 2,
      retryOfRunId: 'failed',
    });
    const api = detailApi(failed, { retryRun: vi.fn().mockResolvedValue(retried) });
    render(<RunDetailPage id="failed" api={api} />);
    await waitFor(() => expect(screen.getByTestId('retry-run')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('retry-run'));
    await waitFor(() =>
      expect(screen.getByTestId('retry-run-link')).toHaveAttribute(
        'href',
        '/dashboard/runs/retry-run',
      ),
    );
    expect(api.retryRun).toHaveBeenCalledWith('failed');
  });

  it('renders terminal infrastructure phases and tests without attempts', async () => {
    const run = makeRun({
      id: 'infra-run',
      phase: 'infra_failed',
      outcome: 'infra_failed',
      tests: [
        {
          id: 'test-no-attempt',
          testId: 'test-no-attempt',
          title: 'unattempted browser test',
          suite: null,
          file: null,
          status: 'blocked',
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          error: null,
          attempts: [],
          artifactIds: [],
          metadata: {},
        },
      ],
    });
    render(<RunDetailPage id={run.id} api={detailApi(run)} />);
    await waitFor(() => expect(screen.getByTestId('run-phase')).toHaveTextContent('infra_failed'));
    expect(screen.getByTestId('run-status')).toHaveTextContent('INFRA_FAILED');
    expect(screen.getByTestId('phase-infra_failed')).toBeInTheDocument();
    expect(screen.getByTestId('test-test-no-attempt')).toHaveTextContent('UNKNOWN');
    expect(screen.getByText('No retry attempts were reported.')).toBeInTheDocument();
  });

  it('surfaces auxiliary evidence and action failures honestly', async () => {
    const active = makeRun({ id: 'active-failure', phase: 'running' });
    const api = detailApi(active, {
      getRunArtifacts: vi.fn().mockRejectedValue(new Error('artifact store offline')),
      cancelRun: vi.fn().mockRejectedValue(new Error('cancel rejected')),
      retryRun: vi.fn().mockRejectedValue(new Error('retry rejected')),
    });
    render(<RunDetailPage id={active.id} api={api} />);
    await waitFor(() =>
      expect(screen.getByText(/artifact metadata could not be refreshed/iu)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('cancel-run'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('cancel rejected'));
  });
});
