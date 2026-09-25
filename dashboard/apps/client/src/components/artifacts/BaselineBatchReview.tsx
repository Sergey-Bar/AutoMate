import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, ChevronLeft, ChevronRight, Check, SkipForward, CheckCheck } from 'lucide-react';
import { fadeSlideUp, safeMotion, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface BaselineEntry {
  id: string;
  testFile: string;
  snapshotName: string;
  expectedPath: string;
  actualPath: string | null;
  diffPath: string | null;
  hasActual: boolean;
  hasDiff: boolean;
  expectedSizeBytes: number;
}

interface BaselineBatchReviewProps {
  baselines: BaselineEntry[];
  onClose: () => void;
}

export function BaselineBatchReview({ baselines, onClose }: BaselineBatchReviewProps) {
  const qc = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, 'accepted' | 'skipped'>>({});

  const current = baselines[currentIndex];
  const total = baselines.length;
  const decidedCount = Object.keys(decisions).length;

  const acceptMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/baselines/${encodeURIComponent(id)}/accept`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Accept failed');
      return res.json();
    },
    onSuccess: (_data, id) => {
      setDecisions((prev) => ({ ...prev, [id]: 'accepted' }));
      advance();
    },
    onError: () => toast.error('Failed to accept baseline'),
  });

  const acceptAllRemainingMutation = useMutation({
    mutationFn: async () => {
      const remaining = baselines.filter((b) => !decisions[b.id]);
      const results = await Promise.allSettled(
        remaining.map(async (b) => {
          const res = await fetch(`/api/baselines/${encodeURIComponent(b.id)}/accept`, {
            method: 'POST',
          });
          if (!res.ok) throw new Error(`Failed: ${b.snapshotName}`);
          return b.id;
        }),
      );
      const accepted = results.filter((r) => r.status === 'fulfilled').length;
      return { accepted, total: remaining.length };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['baselines'] });
      toast.success(`Accepted ${data.accepted} of ${data.total} remaining`);
      onClose();
    },
    onError: () => toast.error('Batch accept failed'),
  });

  const advance = useCallback(() => {
    // Find next undecided item
    for (let i = currentIndex + 1; i < total; i++) {
      const baseline = baselines[i];
      if (baseline && !decisions[baseline.id]) {
        setCurrentIndex(i);
        return;
      }
    }
    // Wrap around to find any undecided before current
    for (let i = 0; i < currentIndex; i++) {
      const baseline = baselines[i];
      if (baseline && !decisions[baseline.id]) {
        setCurrentIndex(i);
        return;
      }
    }
    // All decided
    qc.invalidateQueries({ queryKey: ['baselines'] });
    toast.success('All baselines reviewed!');
    onClose();
  }, [currentIndex, total, decisions, baselines, qc, onClose]);

  const skip = useCallback(() => {
    if (!current) return;
    setDecisions((prev) => ({ ...prev, [current.id]: 'skipped' }));
    advance();
  }, [current, advance]);

  const goNext = useCallback(() => {
    if (currentIndex < total - 1) setCurrentIndex(currentIndex + 1);
  }, [currentIndex, total]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  }, [currentIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
        case 'a':
        case 'A':
          e.preventDefault();
          if (!decisions[current?.id ?? ''] && !acceptMutation.isPending) {
            acceptMutation.mutate(current?.id ?? '');
          }
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          if (!decisions[current?.id ?? '']) {
            skip();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goPrev, goNext, current, decisions, acceptMutation, skip, onClose]);

  if (!current) return null;

  const isDecided = !!decisions[current.id];
  const remainingCount = total - decidedCount;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-review-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0 0 0 / 70%)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        className="relative w-full max-w-5xl max-h-[90vh] mx-4 rounded-2xl border border-border-default bg-bg-surface overflow-hidden flex flex-col"
        variants={safeMotion(fadeSlideUp) as import('framer-motion').Variants}
        initial="hidden"
        animate="visible"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <h2 id="batch-review-title" className="text-sm font-semibold text-text-primary">
              Batch Review
            </h2>
            <span
              className="text-xs px-2 py-0.5 rounded-full tabular bg-running-bg text-running"
            >
              {currentIndex + 1} / {total}
            </span>
            {decidedCount > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full tabular bg-pass-bg text-pass"
              >
                {decidedCount} reviewed
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Close batch review"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Snapshot info */}
          <div className="mb-4">
            <p className="text-sm font-medium text-text-primary">
              {current.snapshotName}
            </p>
            <p className="text-xs font-mono mt-0.5 text-text-tertiary">
              {current.testFile}
            </p>
          </div>

          {/* Side-by-side comparison */}
          <div className="grid grid-cols-2 gap-4">
            {/* Expected */}
            <div>
              <p
                className="text-[11px] uppercase tracking-wider mb-2 font-medium text-text-tertiary"
              >
                Expected (baseline)
              </p>
              <div
                className="rounded-lg overflow-hidden border border-border-subtle aspect-video flex items-center justify-center bg-black/20"
              >
                <img
                  src={current.expectedPath}
                  alt="Expected baseline"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            {/* Actual */}
            <div>
              <p
                className="text-[11px] uppercase tracking-wider mb-2 font-medium text-fail"
              >
                Actual (new)
              </p>
              <div
                className="rounded-lg overflow-hidden border border-fail aspect-video flex items-center justify-center bg-black/20"
              >
                {current.actualPath ? (
                  <img
                    src={current.actualPath}
                    alt="Actual screenshot"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <p className="text-xs text-text-tertiary">
                    No actual screenshot
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Diff image (if available) */}
          {current.diffPath && (
            <div className="mt-4">
              <p
                className="text-[11px] uppercase tracking-wider mb-2 font-medium text-flaky"
              >
                Diff overlay
              </p>
              <div
                className="rounded-lg overflow-hidden border border-flaky bg-black/20 max-h-64 flex items-center justify-center"
              >
                <img
                  src={current.diffPath}
                  alt="Diff overlay"
                  className="max-h-64 object-contain"
                />
              </div>
            </div>
          )}

          {/* Decision overlay */}
          <AnimatePresence>
            {isDecided && (
              <motion.div
                className={cn(
                  'mt-4 flex items-center gap-2 rounded-lg px-3 py-2',
                  decisions[current.id] === 'accepted'
                    ? 'bg-pass-bg text-pass'
                    : 'bg-skip-bg text-skip'
                )}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transition: spring.snappy }}
                exit={{ opacity: 0 }}
              >
                <Check size={14} />
                <span className="text-xs font-medium capitalize">
                  {decisions[current.id]}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle">
          {/* Nav arrows */}
          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              disabled={currentIndex === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary transition-colors disabled:opacity-30"
              aria-label="Previous"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              onClick={goNext}
              disabled={currentIndex === total - 1}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary transition-colors disabled:opacity-30"
              aria-label="Next"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>

          {/* Keyboard hints */}
          <div className="hidden sm:flex items-center gap-3 text-[10px] text-text-tertiary">
            <span>
              <kbd className="px-1 py-0.5 rounded font-mono bg-bg-elevated">←</kbd>
              <kbd className="px-1 py-0.5 rounded font-mono ml-0.5 bg-bg-elevated">→</kbd>
              {' '}Navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded font-mono bg-bg-elevated">A</kbd>
              {' '}Accept
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded font-mono bg-bg-elevated">R</kbd>
              {' '}Skip
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded font-mono bg-bg-elevated">Esc</kbd>
              {' '}Close
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Skip */}
            {!isDecided && (
              <button
                onClick={skip}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary transition-colors"
              >
                <SkipForward size={12} /> Skip
              </button>
            )}

            {/* Accept current */}
            {!isDecided && (
              <button
                onClick={() => acceptMutation.mutate(current.id)}
                disabled={acceptMutation.isPending}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-pass text-white disabled:opacity-50"
              >
                <Check size={12} /> Accept
              </button>
            )}

            {/* Accept all remaining */}
            {remainingCount > 1 && (
              <button
                onClick={() =>
                  toast.promise(acceptAllRemainingMutation.mutateAsync(), {
                    loading: `Accepting ${remainingCount} remaining…`,
                    success: 'All accepted',
                    error: 'Failed',
                  })
                }
                disabled={acceptAllRemainingMutation.isPending}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-running text-white disabled:opacity-50"
              >
                <CheckCheck size={12} /> Accept All ({remainingCount})
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
