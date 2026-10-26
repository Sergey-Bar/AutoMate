import { z } from 'zod/v4';
import { CanonicalRunResultSchema } from '@automate/shared-contracts';
import { useResource } from '../../hooks/useResource.js';
import { createJsonTransport } from '../../lib/json-transport.js';

/**
 * One canonical run: its status, its proof, whether every shard arrived, and every attempt.
 *
 * Read through the shared transport, so the response is parsed against the contract and a
 * failure shows the server's own sentence — not a blanket "Run not found" for a 500, which is
 * what this used to say for every status that was not 200.
 */
const ReportingRunSchema = z.object({ result: CanonicalRunResultSchema });

export function RunExplorer({ runId, fetchImpl }: { runId: string; fetchImpl?: typeof fetch }) {
  const run = useResource(
    () =>
      createJsonTransport('', fetchImpl ?? fetch).get(
        `/api/v1/reporting/runs/${encodeURIComponent(runId)}`,
        ReportingRunSchema,
      ),
    [runId, fetchImpl],
  );
  if (run.status === 'error') return <div role="alert">{run.message}</div>;
  if (run.status === 'loading') return <div>Loading run…</div>;
  const result = run.value.result;
  return (
    <section data-testid="run-explorer" aria-label="Run evidence explorer">
      <h2>Run {result.identity.runId}</h2>
      <p>
        Status: {result.status} · Proof: {result.proof.state} · Completeness:{' '}
        {result.completeness.state}
      </p>
      <ol>
        {result.attempts.map((attempt) => (
          <li key={`${attempt.testId}-${attempt.index}`}>
            {attempt.title} — {attempt.status} (attempt {attempt.index})
          </li>
        ))}
      </ol>
      {result.evidence.length > 0 && <p>{result.evidence.length} evidence references</p>}
    </section>
  );
}
