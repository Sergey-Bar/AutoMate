import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { startRun } from '@/hooks/useRun';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import type { RunOptions } from '@/lib/types';
import { commandPalette, safeMotion } from '@/lib/motion';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface RunTriggerProps {
  onClose: () => void;
}

export function RunTrigger({ onClose }: RunTriggerProps) {
  const navigate = useNavigate();
  const [opts, setOpts] = useState<RunOptions>({
    trace: 'on-first-retry',
    workers: 4,
    retries: 0,
  });
  const [starting, setStarting] = useState(false);

  function set<K extends keyof RunOptions>(key: K, value: RunOptions[K]) {
    setOpts((prev) => ({ ...prev, [key]: value }));
  }

  async function handleStart() {
    setStarting(true);
    try {
      const { runId } = await startRun(opts);
      toast.success('Run started');
      navigate({ to: '/runs/$runId', params: { runId } });
      onClose();
    } catch (err: unknown) {
      toast.error(`Failed to start run: ${(err as Error).message}`);
    } finally {
      setStarting(false);
    }
  }

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus trap: keep Tab within the modal
  const modalRef = useRef<HTMLDivElement>(null);
  const handleFocusTrap = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleFocusTrap);
    return () => window.removeEventListener('keydown', handleFocusTrap);
  }, [handleFocusTrap]);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-40"
        style={{ background: 'oklch(0 0 0 / 60%)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      <div className="fixed inset-0 z-40 flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-trigger-title"
          className="pointer-events-auto w-full max-w-lg rounded-2xl border border-border-default bg-bg-surface overflow-hidden shadow-2xl"
          {...safeMotion(commandPalette)}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
            <h2 id="run-trigger-title" className="text-sm font-semibold text-text-primary">
              New Run
            </h2>
            <button onClick={onClose} className="opacity-60 hover:opacity-100 transition-opacity" aria-label="Close dialog">
              <X size={16} />
            </button>
          </div>

          {/* Form */}
          <div className="p-5 space-y-4">
            {/* grep / tag filter */}
            <Field label="Grep pattern" description="Filter tests by name (regex)">
              <input
                value={opts.grep ?? ''}
                onChange={(e) => set('grep', e.target.value || undefined)}
                placeholder="e.g. @smoke|login"
                className="w-full px-3 py-2 text-sm rounded-md border border-border-default text-text-primary bg-transparent outline-none"
              />
            </Field>

            {/* Workers */}
            <Field label="Workers" description={`Parallel workers: ${opts.workers}`}>
              <input
                type="range"
                min={1}
                max={16}
                value={opts.workers ?? 4}
                onChange={(e) => set('workers', Number(e.target.value))}
                className="w-full accent-running"
              />
            </Field>

            {/* Retries */}
            <Field label="Retries" description="Number of retry attempts on failure">
              <div className="flex items-center gap-2">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => set('retries', n)}
                    className={cn(
                      'w-8 h-8 rounded-lg border text-sm font-medium transition-colors',
                      opts.retries === n
                        ? 'bg-running border-running text-white'
                        : 'bg-bg-elevated border-border-default text-text-secondary',
                    )}
                    aria-label={`${n} retries`}
                    aria-pressed={opts.retries === n}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>

            {/* Trace mode */}
            <Field label="Trace" description="When to capture trace files">
              <select
                value={opts.trace ?? 'on-first-retry'}
                onChange={(e) => set('trace', e.target.value as RunOptions['trace'])}
                className="px-3 py-2 text-sm rounded-md border border-border-default text-text-primary bg-transparent outline-none"
              >
                <option value="off">Off</option>
                <option value="on-first-retry">On first retry</option>
                <option value="on">Always on</option>
                <option value="retain-on-failure">Retain on failure</option>
              </select>
            </Field>

            {/* Toggles */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer text-text-secondary">
                <input type="checkbox" checked={opts.headed} onChange={(e) => set('headed', e.target.checked)} className="accent-running" />
                Headed
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer text-text-secondary">
                <input type="checkbox" checked={opts.lastFailed} onChange={(e) => set('lastFailed', e.target.checked)} className="accent-running" />
                Last failed only
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer text-text-secondary">
                <input type="checkbox" checked={opts.updateSnapshots} onChange={(e) => set('updateSnapshots', e.target.checked)} className="accent-running" />
                Update snapshots
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-border-subtle bg-bg-elevated">
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleStart}
              loading={starting}
            >
              Run Tests ↵
            </Button>
          </div>
        </motion.div>
      </div>
    </>
  );
}

function Field({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-sm font-medium text-text-primary">{label}</label>
        <span className="text-xs text-text-tertiary">{description}</span>
      </div>
      {children}
    </div>
  );
}
