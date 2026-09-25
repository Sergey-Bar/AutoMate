import React, { useState } from 'react';
import { useRepairAttempts, useRepairAttemptDetail, type RepairAttempt } from '@/hooks/useRepairAttempts';
import { FeatureGate } from '@/components/FeatureGate';
import { EmptyState } from '@/components/shared/EmptyState';
import { Skeleton } from '@/components/shared/Skeleton';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/formatters';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Copy, ExternalLink, Info, Loader2 } from 'lucide-react';

function StatusChip({ status }: { status: RepairAttempt['status'] }) {
  let bg = 'bg-text-tertiary/10';
  let text = 'text-text-secondary';
  let border = 'border-text-tertiary/20';

  if (status === 'comment_posted' || status === 'rerun_requested') {
    bg = 'bg-[oklch(0.5_0.15_250)]/10';
    text = 'text-[oklch(0.5_0.15_250)]';
    border = 'border-[oklch(0.5_0.15_250)]/20';
  } else if (status === 'escalated' || status === 'comment_failed') {
    bg = 'bg-fail/10';
    text = 'text-fail';
    border = 'border-fail/20';
  }

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium capitalize border',
        bg,
        text,
        border
      )}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function RepairAttemptRow({ attempt, sessionId, maxAttempts = 3 }: { attempt: RepairAttempt; sessionId: string, maxAttempts?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const { data: detail, isLoading } = useRepairAttemptDetail(sessionId, expanded ? attempt.id : null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden mb-3 bg-bg-surface">
      <div 
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-bg-subtle transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="w-4 h-4 text-text-tertiary" /> : <ChevronRight className="w-4 h-4 text-text-tertiary" />}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-text-primary">Attempt {attempt.attemptNumber}</span>
              <span className="text-xs text-text-tertiary">of {maxAttempts}</span>
              <StatusChip status={attempt.status} />
            </div>
            <div className="text-xs text-text-secondary mt-0.5 flex items-center gap-2">
              <span>{timeAgo(attempt.createdAt)}</span>
              {attempt.errorMessage && (
                <span className="text-fail flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {attempt.errorMessage}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {attempt.commentUrl && (
            <a 
              href={attempt.commentUrl} 
              target="_blank" 
              rel="noreferrer"
              className="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3" />
              View Comment
            </a>
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-4 border-t border-border-subtle bg-bg-base text-sm">
          <div className="flex items-start gap-2 mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded text-blue-600 dark:text-blue-400">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-xs">
              This is a PR comment instruction, not an automatic merge. The agent has posted this payload to the repository to instruct fixing the failing tests.
            </p>
          </div>
          
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-text-primary">Repair Payload</h4>
            {detail?.payload && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => handleCopy(detail.payload!)}
                className="h-7 text-xs"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-pass" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            )}
          </div>
          
          <div className="relative">
            {isLoading ? (
              <div className="space-y-2 py-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : detail?.payload ? (
              <pre className="bg-bg-surface border border-border-subtle rounded-md p-3 overflow-x-auto text-xs text-text-secondary whitespace-pre-wrap max-h-96">
                {detail.payload}
              </pre>
            ) : (
              <p className="text-text-tertiary text-xs italic">No payload available for this attempt.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function RepairHistory({ sessionId }: { sessionId: string }) {
  const { data: attempts, isLoading, error } = useRepairAttempts(sessionId);

  if (isLoading) {
    return (
      <div className="space-y-3 mt-4">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-fail/20 bg-fail/5 rounded-lg text-fail text-sm mt-4 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5" />
        <div>
          <p className="font-medium">Failed to load repair history</p>
          <p className="text-xs opacity-80">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  if (!attempts || attempts.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState 
          title="No repair attempts" 
          description="The agent hasn't attempted to repair any failing tests for this session yet."
          illustration="shield"
        />
      </div>
    );
  }

  return (
    <FeatureGate flag="agent-repair">
      <ErrorBoundary>
        <div className="mt-4">
          <h3 className="text-sm font-medium text-text-primary mb-3">Repair History</h3>
          <div className="space-y-1">
            {attempts.map(attempt => (
              <RepairAttemptRow key={attempt.id} attempt={attempt} sessionId={sessionId} />
            ))}
          </div>
        </div>
      </ErrorBoundary>
    </FeatureGate>
  );
}
