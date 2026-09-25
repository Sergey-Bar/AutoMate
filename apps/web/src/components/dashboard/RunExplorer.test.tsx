import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RunExplorer } from './RunExplorer.js';

const result = {
  contractVersion: '2',
  identity: { runId: 'run-1', workspaceId: 'workspace-1' },
  status: 'passed',
  startedAt: '2026-09-25T00:00:00.000Z',
  attempts: [
    {
      index: 1,
      testId: 'test-1',
      specPath: 'tests/example.spec.ts',
      title: 'Example',
      status: 'passed',
      rawStatus: 'passed',
      startedAt: '2026-09-25T00:00:00.000Z',
      evidence: [],
      flakiness: 'unknown',
    },
  ],
  evidence: [],
  provenance: {
    producer: 'playwright',
    producerVersion: '1',
    adapterVersion: '1',
    sourceDigest: 'a'.repeat(64),
    sourceUri: 'artifact://run/report.json',
  },
  retention: { class: 'standard' },
  proof: { state: 'verified', digest: 'a'.repeat(64), verifier: 'test' },
  completeness: { state: 'complete', missingShards: [], duplicateShards: [] },
  raw: {},
};

describe('RunExplorer', () => {
  it('renders canonical attempts and evidence state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ result }), { status: 200 })),
    );
    render(<RunExplorer runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('run-explorer')).toBeInTheDocument());
    expect(screen.getByText(/Proof: verified/)).toBeInTheDocument();
    expect(screen.getByText('Example — passed (attempt 1)')).toBeInTheDocument();
  });
});
