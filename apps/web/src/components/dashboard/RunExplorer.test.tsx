import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { makeCanonicalRunResult } from '../../test-utils.js';
import { RunExplorer } from './RunExplorer.js';

function answering(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RunExplorer', () => {
  it('renders canonical attempts and evidence state, read with the session cookie', async () => {
    const fetchImpl = answering({ result: makeCanonicalRunResult() });
    vi.stubGlobal('fetch', fetchImpl);
    render(<RunExplorer runId="run 1" />);
    await waitFor(() => expect(screen.getByTestId('run-explorer')).toBeInTheDocument());
    expect(screen.getByText(/Proof: verified/)).toBeInTheDocument();
    expect(screen.getByText('Example — passed (attempt 1)')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/reporting/runs/run%201',
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    );
  });

  it('counts evidence references when the run has some', async () => {
    const result = {
      ...makeCanonicalRunResult(),
      evidence: [
        {
          uri: 'artifact://run/trace.zip',
          mediaType: 'application/zip',
          byteSize: 10,
          digest: 'a'.repeat(64),
        },
      ],
    };
    render(<RunExplorer runId="run-1" fetchImpl={answering({ result })} />);
    expect(await screen.findByText('1 evidence references')).toBeInTheDocument();
  });

  it('refuses a body that is not the contract, in words', async () => {
    render(<RunExplorer runId="run-1" fetchImpl={answering({ result: { status: 'complete' } })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('did not match the expected shape');
  });

  it("shows the server's sentence for a refusal, not a blanket not-found", async () => {
    render(
      <RunExplorer
        runId="run-1"
        fetchImpl={answering({ error: { code: 'INTERNAL', message: 'Store unavailable' } }, 500)}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Store unavailable');
  });

  it('says it is loading while the read is in flight', () => {
    render(
      <RunExplorer runId="run-1" fetchImpl={vi.fn(() => new Promise<Response>(() => undefined))} />,
    );
    expect(screen.getByText('Loading run…')).toBeInTheDocument();
  });
});
