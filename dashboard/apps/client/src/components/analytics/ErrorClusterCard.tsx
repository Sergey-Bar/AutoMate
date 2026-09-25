import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { safeMotion, fadeSlideUp } from '@/lib/motion';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';

interface ErrorCluster {
  clusterId: string;
  sampleError: string;
  sampleStack: string | null;
  testIds: string[];
  count: number;
}

interface ErrorClusterCardProps {
  cluster: ErrorCluster;
}

export function ErrorClusterCard({ cluster }: ErrorClusterCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      variants={safeMotion(fadeSlideUp) as import('framer-motion').Variants}
      initial="hidden"
      animate="visible"
      className="rounded-lg border border-border-subtle overflow-hidden bg-bg-surface"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-90 transition-opacity"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse error cluster details' : 'Expand error cluster details'}
      >
        <AlertCircle size={16} className="shrink-0 text-fail" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate text-text-primary">
            {cluster.sampleError.slice(0, 120)}{cluster.sampleError.length > 120 ? '…' : ''}
          </p>
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 text-fail"
          style={{
            background: 'color-mix(in oklch, var(--color-fail) 15%, transparent)',
          }}
        >
          {cluster.count} test{cluster.count !== 1 ? 's' : ''}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 border-t border-border-subtle">
              {cluster.sampleStack && (
                <pre
                  className="text-[11px] mt-2 p-2 rounded overflow-x-auto max-h-40 overflow-y-auto bg-bg-elevated text-text-secondary"
                  style={{
                    fontFamily: 'var(--font-mono, monospace)',
                  }}
                >
                  {cluster.sampleStack}
                </pre>
              )}
              <p className="text-[11px] mt-2 text-text-tertiary">
                Affected test IDs: {cluster.testIds.slice(0, 5).join(', ')}{cluster.testIds.length > 5 ? `, +${cluster.testIds.length - 5} more` : ''}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface ErrorClustersSectionProps {
  clusters: ErrorCluster[];
}

export function ErrorClustersSection({ clusters }: ErrorClustersSectionProps) {
  if (clusters.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
        Error Clusters ({clusters.length})
      </h3>
      {clusters.map((c) => (
        <ErrorClusterCard key={c.clusterId} cluster={c} />
      ))}
    </div>
  );
}
