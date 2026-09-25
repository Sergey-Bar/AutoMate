import { useQuery } from '@tanstack/react-query';
import { CrossProductLink } from '@/components/CrossProductLink';
import { AlertTriangle, Loader2, RefreshCw, CheckCircle2, ShieldAlert, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface AiTriageCardProps {
  runId: string;
  testTitle?: string;
}

interface TriageFailure {
  testTitle: string;
  rootCause: string;
  suggestedFix: string;
  confidence: 'high' | 'medium' | 'low';
}

interface TriageResponse {
  runId: string;
  analyzedAt: string;
  failures: TriageFailure[];
  summary: string;
}

export function AiTriageCard({ runId, testTitle }: AiTriageCardProps) {
  const { data, error, isLoading, refetch, isFetching } = useQuery<TriageResponse | null>({
    queryKey: ['run-triage', runId],
    queryFn: async () => {
      const res = await fetch(`/ai/api/service/run-triage/${runId}`);
      if (res.status === 404) return null; // Not found, don't show
      if (res.status === 202) {
        const body = await res.json();
        throw new Error(body.message || 'pending'); // Throw special error to trigger retry behavior
      }
      if (!res.ok) throw new Error('Failed to fetch triage data');
      return res.json() as Promise<TriageResponse>;
    },
    retry: (failureCount, err) => {
      if (import.meta.env.MODE === 'test') return false;
      if (err.message === 'pending' || err.message === 'Triage in progress') return true;
      return failureCount < 3;
    },
    retryDelay: (retryCount, err) => {
      if (err.message === 'pending' || err.message === 'Triage in progress') return 5000;
      return Math.min(1000 * 2 ** retryCount, 30000);
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 rounded-md border border-border-subtle bg-bg-elevated flex items-center justify-center gap-2 text-text-tertiary">
        <Loader2 className="animate-spin" size={16} />
        <span className="text-sm">Analyzing failure...</span>
      </div>
    );
  }

  // If 404
  if (!isLoading && !error && data === null) {
    return null;
  }

  if (error) {
    if (error.message === 'pending' || error.message === 'Triage in progress') {
      return (
        <div className="p-4 rounded-md border border-border-subtle bg-bg-elevated flex items-center justify-center gap-2 text-text-tertiary">
          <Loader2 className="animate-spin" size={16} />
          <span className="text-sm">AI is analyzing this failure...</span>
        </div>
      );
    }

    return (
      <div className="p-4 rounded-md border border-error/20 bg-error/5 flex flex-col items-center justify-center gap-2 text-error">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} />
          <span className="text-sm font-medium">AI analysis unavailable</span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-bg-surface hover:bg-bg-hover text-text-secondary border border-border-subtle transition-colors"
        >
          <RefreshCw size={12} className={cn(isFetching && "animate-spin")} />
          Retry
        </button>
      </div>
    );
  }

  if (!data || !data.failures?.length) return null;

  // Find the specific failure if a title is provided, otherwise show the first one or generic
  const failure = testTitle
    ? data.failures.find(f => f.testTitle === testTitle)
    : data.failures[0];

  if (!failure) return null;

  const confidenceColor = {
    high: 'bg-success/10 text-success border-success/20',
    medium: 'bg-warning/10 text-warning border-warning/20',
    low: 'bg-text-tertiary/10 text-text-tertiary border-border-subtle',
  }[failure.confidence] || 'bg-text-tertiary/10 text-text-tertiary border-border-subtle';

  return (
    <div className="p-4 rounded-md border border-border-subtle bg-bg-elevated flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-text-primary">
          <Sparkles size={16} className="text-brand" />
          <h4 className="text-sm font-semibold">AI Analysis</h4>
        </div>
        <div className={cn("px-2 py-0.5 rounded text-xs font-medium border flex items-center gap-1", confidenceColor)}>
          {failure.confidence === 'high' && <CheckCircle2 size={12} />}
          {failure.confidence === 'medium' && <AlertTriangle size={12} />}
          {failure.confidence === 'low' && <ShieldAlert size={12} />}
          <span className="capitalize">{failure.confidence} Confidence</span>
        </div>
      </div>

      <div className="text-sm">
        <div className="mb-2">
          <strong className="text-text-secondary block mb-1">Root Cause:</strong>
          <p className="text-text-primary">{failure.rootCause}</p>
        </div>
        <div>
          <strong className="text-text-secondary block mb-1">Suggested Fix:</strong>
          <p className="text-text-primary">{failure.suggestedFix}</p>
        </div>
      </div>

      <div className="mt-2 pt-3 border-t border-border-subtle">
        <CrossProductLink
          targetApp="ai"
          path={`/chat?runId=${runId}${testTitle ? `&test=${encodeURIComponent(testTitle)}` : ''}`}
          label="Ask AI for more details"
          className="text-xs text-brand hover:underline flex items-center gap-1 w-fit"
        />
      </div>
    </div>
  );
}
