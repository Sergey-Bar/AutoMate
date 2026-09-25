import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RunsListPage } from './index.js';
import { makeApi, makeRun } from '../../test-utils.js';

const passedRun = makeRun({
  id: 'run-abc12345',
  projectId: 'automate',
  phase: 'complete',
  outcome: 'passed',
  createdAt: '2026-05-26T10:00:00.000Z',
  summary: {
    total: 20,
    passed: 20,
    failed: 0,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: 3_000,
  },
});

const failedRun = makeRun({
  id: 'run-def67890',
  projectId: 'dashboard',
  phase: 'complete',
  outcome: 'failed',
  createdAt: '2026-05-26T09:00:00.000Z',
  summary: {
    total: 15,
    passed: 10,
    failed: 5,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: 5_000,
  },
});

describe('RunsListPage', () => {
  it('renders loading state initially', () => {
    const api = makeApi({
      getRuns: vi.fn(() => new Promise<ReturnType<typeof makeRun>[]>(() => undefined)),
    });
    render(<RunsListPage api={api} />);
    expect(screen.getByTestId('runs-list-loading')).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    const api = makeApi({ getRuns: vi.fn().mockRejectedValue(new Error('Network error')) });
    render(<RunsListPage api={api} />);
    await waitFor(() => expect(screen.getByTestId('runs-list-error')).toBeInTheDocument());
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('renders empty state without claiming a passing release', async () => {
    render(<RunsListPage api={makeApi()} />);
    await waitFor(() => expect(screen.getByTestId('runs-list-empty')).toBeInTheDocument());
    expect(screen.getByText(/will not infer|No execution evidence/iu)).toBeInTheDocument();
  });

  it('renders canonical run phase and outcome with statistics', async () => {
    render(
      <RunsListPage
        api={makeApi({ getRuns: vi.fn().mockResolvedValue([passedRun, failedRun]) })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('runs-list-page')).toBeInTheDocument());
    expect(screen.getByTestId('run-row-run-abc12345')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-def67890')).toBeInTheDocument();
    expect(screen.getByTestId('run-outcome-run-abc12345')).toHaveTextContent('passed');
    expect(screen.getByTestId('run-outcome-run-def67890')).toHaveTextContent('failed');
    expect(screen.getByTestId('stat-total')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-passed')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-failed')).toHaveTextContent('1');
  });

  it('renders active phases and canonical detail links', async () => {
    const activeRun = makeRun({ id: 'run-active', projectId: 'project', phase: 'running' });
    render(<RunsListPage api={makeApi({ getRuns: vi.fn().mockResolvedValue([activeRun]) })} />);
    await waitFor(() => expect(screen.getByTestId('stat-running')).toHaveTextContent('1'));
    const link = screen.getByRole('link', { name: 'run-acti' });
    expect(link).toHaveAttribute('href', '/dashboard/runs/run-active');
  });

  it('renders UNKNOWN for missing project and duration', async () => {
    const unknownRun = makeRun({
      id: 'run-unknown',
      projectId: null,
      phase: 'queued',
      summary: { ...passedRun.summary, total: 0, passed: 0, durationMs: null },
    });
    render(<RunsListPage api={makeApi({ getRuns: vi.fn().mockResolvedValue([unknownRun]) })} />);
    await waitFor(() => expect(screen.getByTestId('run-row-run-unknown')).toBeInTheDocument());
    const row = screen.getByTestId('run-row-run-unknown');
    expect(row).toHaveTextContent('UNKNOWN');
    expect(row).toHaveTextContent('No tests reported');
  });
});
