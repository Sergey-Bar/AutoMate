import { useEffect, useState } from 'react';
import type { CanonicalRunResult } from '@automate/shared-contracts';

export function RunExplorer({ runId }: { runId: string }) {
  const [result, setResult] = useState<CanonicalRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/reporting/runs/${encodeURIComponent(runId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Run not found');
        return (await response.json()) as { result: CanonicalRunResult };
      })
      .then((payload) => { if (active) setResult(payload.result); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load run'); });
    return () => { active = false; };
  }, [runId]);
  if (error) return <div role="alert">{error}</div>;
  if (!result) return <div>Loading run…</div>;
  return (
    <section data-testid="run-explorer" aria-label="Run evidence explorer">
      <h2>Run {result.identity.runId}</h2>
      <p>Status: {result.status} · Proof: {result.proof.state} · Completeness: {result.completeness.state}</p>
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
