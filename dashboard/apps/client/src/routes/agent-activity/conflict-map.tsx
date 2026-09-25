import { useAgentConflicts } from '@/hooks/useAgentConflicts';
import { FeatureGate } from '@/components/FeatureGate';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { AlertTriangle, Info, ShieldAlert, GitBranch, Files } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { timeAgo } from '@/lib/formatters';

export function ConflictMap() {
  const { t } = useTranslation();
  const { data: conflicts, isLoading, error } = useAgentConflicts();

  if (isLoading) {
    return <div className="p-8 text-center text-text-secondary text-sm animate-pulse">Loading conflicts...</div>;
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-fail/10 border border-fail/20 text-sm text-fail">
        {error instanceof Error ? error.message : 'An error occurred'}
      </div>
    );
  }

  if (!conflicts || conflicts.length === 0) {
    return (
      <EmptyState
        title="No File Overlaps"
        description="There are currently no active agent sessions modifying the same files."
      />
    );
  }

  return (
    <FeatureGate flag="multi-agent-awareness">
      <ErrorBoundary label="Conflict Map">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {conflicts.map((conflict) => (
              <div
                key={conflict.id}
                className={cn(
                  "rounded-xl border p-4 space-y-3 shadow-sm transition-shadow",
                  conflict.severity === 'critical' ? 'border-fail/30 bg-fail/5' :
                  conflict.severity === 'warning' ? 'border-warning/30 bg-warning/5' :
                  'border-border-default bg-bg-surface'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-medium text-sm">
                    <GitBranch size={16} className="text-text-secondary" />
                    {conflict.repository}
                  </div>
                  {conflict.severity === 'critical' && <ShieldAlert size={16} className="text-fail" />}
                  {conflict.severity === 'warning' && <AlertTriangle size={16} className="text-warning" />}
                  {conflict.severity === 'info' && <Info size={16} className="text-info" />}
                </div>
                
                <div className="space-y-1">
                  <div className="text-xs text-text-secondary uppercase tracking-wider font-semibold">Sessions Involved</div>
                  <div className="flex flex-wrap gap-1">
                    {conflict.sessionIds.map(id => (
                      <span key={id} className="px-2 py-0.5 bg-white/5 border border-border-subtle rounded text-xs font-mono text-text-secondary">
                        {id.slice(0, 8)}...
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-text-secondary uppercase tracking-wider font-semibold">
                    <Files size={12} />
                    Overlapping Files ({conflict.overlappingFiles.length})
                  </div>
                  <ul className="text-xs font-mono space-y-0.5 bg-black/20 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
                    {conflict.overlappingFiles.map(file => (
                      <li key={file} className="text-text-primary whitespace-nowrap">{file}</li>
                    ))}
                  </ul>
                </div>
                
                <div className="text-[10px] text-text-tertiary flex justify-between">
                  <span>Detected {timeAgo(conflict.firstDetectedAt)}</span>
                  <span className="capitalize">{conflict.severity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </ErrorBoundary>
    </FeatureGate>
  );
}
