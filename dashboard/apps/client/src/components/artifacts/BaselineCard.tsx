import { useState, useRef, useCallback, useEffect, MouseEvent as ReactMouseEvent, KeyboardEvent } from 'react';
import { Image, Check, AlertTriangle, SplitSquareHorizontal } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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

interface BaselineCardProps {
  baseline: BaselineEntry;
}

export function BaselineCard({ baseline }: BaselineCardProps) {
  const qc = useQueryClient();
  const [compareMode, setCompareMode] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSliderPos(p => Math.max(0, p - 5));
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSliderPos(p => Math.min(100, p + 5));
    }
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      setSliderPos((x / rect.width) * 100);
    };
    const handleUp = () => setIsDragging(false);
    
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging]);

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/baselines/${encodeURIComponent(baseline.id)}/accept`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Accept failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['baselines'] });
      toast.success(`Accepted: ${baseline.snapshotName}`);
    },
    onError: () => toast.error('Failed to accept baseline'),
  });

  const hasDiff = baseline.hasActual || baseline.hasDiff;

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden transition-colors bg-bg-surface',
        hasDiff ? 'border-fail' : 'border-border-default'
      )}
    >
      {/* Preview */}
      <div className="relative aspect-video bg-black/20 flex items-center justify-center overflow-hidden">
        {baseline.diffPath ? (
          <img
            src={baseline.diffPath}
            alt={`Diff: ${baseline.snapshotName}`}
            className="w-full h-full object-contain"
          />
        ) : (
          <img
            src={baseline.expectedPath}
            alt={baseline.snapshotName}
            className="w-full h-full object-contain"
          />
        )}
        {hasDiff && (
          <div
            className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 bg-fail-bg text-fail"
          >
            <AlertTriangle size={10} /> Changed
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <Image size={13} className="text-text-tertiary" />
          <p className="text-xs font-medium truncate text-text-primary">
            {baseline.snapshotName}
          </p>
        </div>
        <p className="text-[11px] font-mono truncate mb-2 text-text-tertiary">
          {baseline.testFile}
        </p>

        {/* Side-by-side thumbnails or slider when diff exists */}
        {baseline.hasActual && !compareMode && (
          <div className="grid grid-cols-2 gap-1 mb-2">
            <div className="rounded overflow-hidden border border-border-subtle bg-black/20">
              <p className="text-[9px] text-center py-0.5 bg-bg-elevated text-text-tertiary">
                Expected
              </p>
              <img src={baseline.expectedPath} alt="expected" className="w-full aspect-video object-contain" />
            </div>
            <div className="rounded overflow-hidden border border-fail bg-black/20">
              <p className="text-[9px] text-center py-0.5 bg-fail-bg text-fail">
                Actual
              </p>
              <img src={baseline.actualPath!} alt="actual" className="w-full aspect-video object-contain" />
            </div>
          </div>
        )}
        
        {baseline.hasActual && compareMode && (
          <div
            ref={containerRef}
            className="relative aspect-[2/1] rounded overflow-hidden mb-2 bg-black/20 touch-none select-none border border-border-subtle"
          >
            <div className="absolute inset-0 bg-transparent w-full h-full flex items-center justify-center pointer-events-none">
              <img src={baseline.actualPath!} alt="actual" className="w-full h-full object-contain" />
            </div>
            <div 
              className="absolute inset-0 bg-black/20 w-full h-full flex items-center justify-center pointer-events-none"
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
              <img 
                src={baseline.expectedPath} 
                alt="expected" 
                className="w-full h-full object-contain"
              />
            </div>
            <div className="absolute top-1 left-1 text-[9px] px-1 py-0.5 bg-bg-elevated/80 text-text-tertiary rounded z-0 pointer-events-none font-medium">Expected</div>
            <div className="absolute top-1 right-1 text-[9px] px-1 py-0.5 bg-fail-bg/80 text-fail rounded z-0 pointer-events-none font-medium">Actual</div>
            
            <div
              role="slider"
              aria-valuenow={sliderPos}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Image comparison slider"
              tabIndex={0}
              className="absolute top-0 bottom-0 w-[3px] bg-white cursor-col-resize z-10 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
              style={{ left: `calc(${sliderPos}% - 1.5px)` }}
              onMouseDown={handleMouseDown}
              onKeyDown={handleKeyDown}
            >
              <div className="absolute w-4 h-6 bg-white rounded shadow border border-border-subtle flex flex-col items-center justify-center gap-[2px]">
                <div className="w-0.5 h-[14px] bg-border-strong rounded-full" />
                <div className="w-0.5 h-[14px] bg-border-strong rounded-full" />
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] tabular text-text-tertiary">
            {(baseline.expectedSizeBytes / 1024).toFixed(0)} KB
          </span>
          <div className="flex items-center gap-1.5">
            {baseline.hasActual && (
              <button
                type="button"
                onClick={() => setCompareMode(m => !m)}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors border",
                  compareMode 
                    ? "bg-bg-elevated text-text-primary border-border-default" 
                    : "bg-bg-surface text-text-secondary border-transparent hover:bg-bg-elevated"
                )}
              >
                <SplitSquareHorizontal size={11} /> {compareMode ? 'Split' : 'Compare'}
              </button>
            )}
            {hasDiff && (
              <button
                type="button"
                onClick={() =>
                  toast.promise(acceptMutation.mutateAsync(), {
                    loading: 'Accepting…',
                    success: 'Baseline updated',
                    error: 'Failed',
                  })
                }
                disabled={acceptMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors bg-pass-bg text-pass disabled:opacity-50"
              >
                <Check size={11} /> Accept
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
