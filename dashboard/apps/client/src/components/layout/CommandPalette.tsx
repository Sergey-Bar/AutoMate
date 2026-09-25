import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { commandPalette, safeMotion } from '@/lib/motion';
import { useRuns } from '@/hooks/useRun';
import { getUserFriendlyError } from '@/lib/errorMessages';
import { Sparkles, Loader2, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFeatureStore } from '@/store/featureStore';
import { SuggestedQueries } from './SuggestedQueries';

interface CommandPaletteProps {
  onClose: () => void;
}

// ── NL Query types ───────────────────────────────────────────────────────────

interface NLQueryResponse {
  query: string;
  sql: string;
  results: Record<string, unknown>[];
  resultCount: number;
}

interface NLErrorResponse {
  error: string;
  sql?: string;
}

// ── NL Results Component ─────────────────────────────────────────────────────

function NLResults({ data }: { data: NLQueryResponse }) {
  const columns = data.results.length > 0 ? Object.keys(data.results[0] ?? {}) : [];
  const maxCols = 6; // cap visible columns for readability
  const visibleCols = columns.slice(0, maxCols);

  return (
    <div className="px-3 py-2">
      {/* Result count */}
      <div className={cn('text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1', 'text-text-tertiary')}>
        <Sparkles size={10} />
        {data.resultCount} result{data.resultCount !== 1 ? 's' : ''}
      </div>

      {/* Results table */}
      {data.results.length > 0 && (
        <div className={cn('overflow-x-auto rounded border', 'border-border-subtle')}>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-bg-surface">
                {visibleCols.map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className={cn('text-left px-2 py-1.5 font-medium border-b', 'text-text-secondary border-border-subtle')}
                  >
                    {col}
                  </th>
                ))}
                {columns.length > maxCols && (
                  <th
                    className={cn('text-left px-2 py-1.5 font-medium border-b', 'text-text-tertiary border-border-subtle')}
                  >
                    +{columns.length - maxCols} more
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.results.slice(0, 20).map((row) => (
                <tr
                  key={JSON.stringify(row)}
                  className={cn('border-b last:border-b-0', 'border-border-subtle')}
                >
                  {visibleCols.map((col) => (
                    <td
                      key={col}
                      className={cn('px-2 py-1 max-w-48 truncate', 'text-text-primary')}
                      title={String(row[col] ?? '')}
                    >
                      {String(row[col] ?? '—')}
                    </td>
                  ))}
                  {columns.length > maxCols && (
                    <td className={cn('px-2 py-1', 'text-text-tertiary')}>…</td>
                  )}
                </tr>
              ))}
              {data.results.length > 20 && (
                <tr>
                  <td
                    colSpan={visibleCols.length + (columns.length > maxCols ? 1 : 0)}
                    className={cn('px-2 py-1.5 text-center', 'text-text-tertiary')}
                  >
                    Showing 20 of {data.resultCount} rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Generated SQL */}
      <details className="mt-2">
        <summary className={cn('text-[10px] cursor-pointer select-none flex items-center gap-1', 'text-text-tertiary')}>
          <ChevronRight size={10} className="inline transition-transform" />
          Generated SQL
        </summary>
        <pre className={cn('mt-1 p-2 rounded text-[11px] overflow-x-auto font-mono border', 'bg-bg-surface text-text-secondary border-border-subtle')}>
          {data.sql}
        </pre>
      </details>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { data: runs } = useRuns();
  const nlEnabled = useFeatureStore((s) => s.flags['nl-query']);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlResult, setNlResult] = useState<NLQueryResponse | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);

  const canUseNL = nlEnabled !== false;
  const isNLMode = canUseNL && inputValue.startsWith('?');
  const nlQuery = inputValue.slice(1).trim();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function go(to: string) {
    navigate({ to });
    onClose();
  }

  const executeNLQuery = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setNlLoading(true);
    setNlResult(null);
    setNlError(null);

    try {
      const res = await fetch('/api/nl-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });

      if (!res.ok) {
        const err = (await res.json()) as NLErrorResponse;
        setNlError(getUserFriendlyError(err.error ?? 'Query failed'));
        return;
      }

      const data = (await res.json()) as NLQueryResponse;
      setNlResult(data);
    } catch (err) {
      setNlError(getUserFriendlyError(err instanceof Error ? err.message : 'Network error'));
    } finally {
      setNlLoading(false);
    }
  }, []);

  function handleNLKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && isNLMode && nlQuery) {
      e.preventDefault();
      executeNLQuery(nlQuery);
    }
  }

  function handleSuggestionClick(query: string) {
    setInputValue(`?${query}`);
    executeNLQuery(query);
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        ref={overlayRef}
        className="fixed inset-0 z-50"
        style={{ background: 'oklch(0 0 0 / 60%)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Palette */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] px-4 pointer-events-none">
        <motion.div
          className={cn('glass-command-palette w-full max-w-140 border rounded-xl shadow-2xl pointer-events-auto overflow-hidden', 'border-border-default')}
          variants={safeMotion(commandPalette) as import('framer-motion').Variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="dialog"
          aria-modal="true"
          aria-label="Command Palette"
        >
          <Command className="flex flex-col" aria-label="Command Palette">
            <div
              className={cn('flex items-center px-4 border-b gap-2', 'border-border-subtle')}
            >
              {isNLMode && (
                <span
                  className={cn('flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded', 'text-text-primary')}
                  style={{
                    background: 'oklch(0.65 0.15 280 / 20%)',
                  }}
                >
                  <Sparkles size={10} />
                  NL
                </span>
              )}
              <Command.Input
                autoFocus
                placeholder={isNLMode ? 'Ask in natural language… (Enter to search)' : canUseNL ? 'Search runs, tests, actions… (? for NL query)' : 'Search runs, tests, actions…'}
                className={cn('flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-text-tertiary', 'text-text-primary')}
                value={inputValue}
                onValueChange={setInputValue}
                onKeyDown={handleNLKeyDown}
              />
              {nlLoading && (
                <Loader2 size={14} className={cn('animate-spin', 'text-text-tertiary')} />
              )}
              <kbd
                className={cn('text-[10px] px-1.5 py-0.5 rounded border', 'text-text-tertiary border-border-default')}
              >
                ESC
              </kbd>
            </div>

            {isNLMode ? (
              /* NL Mode content */
              <div className="overflow-y-auto max-h-96 py-2">
                <AnimatePresence mode="wait">
                  {nlLoading && (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={cn('flex items-center justify-center gap-2 py-8', 'text-text-tertiary')}
                    >
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-sm">Translating to SQL…</span>
                    </motion.div>
                  )}

                  {nlError && !nlLoading && (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={cn('flex items-center gap-2 px-4 py-3 mx-3 rounded', 'text-fail')}
                      style={{
                        background: 'oklch(0.5 0.15 25 / 10%)',
                      }}
                    >
                      <AlertTriangle size={14} />
                      <span className="text-sm">{nlError}</span>
                    </motion.div>
                  )}

                  {nlResult && !nlLoading && (
                    <motion.div
                      key="results"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      <NLResults data={nlResult} />
                    </motion.div>
                  )}

                  {!nlLoading && !nlResult && !nlError && (
                    <motion.div
                      key="suggestions"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <SuggestedQueries onSelect={handleSuggestionClick} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              /* Standard command palette */
              <Command.List className="overflow-y-auto max-h-80 py-2">
                <Command.Empty className={cn('text-sm text-center py-6', 'text-text-tertiary')}>
                  No results found.
                </Command.Empty>

                {/* Navigation actions */}
                <Command.Group
                  heading="Navigate"
                  className={cn('px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider', 'text-text-tertiary')}
                >
                  {([
                    ['Dashboard', '/', 'G D'],
                    ['All Runs', '/runs', 'G R'],
                    ['Test Explorer', '/tests', 'G T'],
                    ['Analytics', '/analytics', 'G A'],
                    ['Config', '/config', 'G C'],
                  ] as [string, string, string][]).map(([label, to, shortcut]) => (
                    <Command.Item
                      key={to}
                      value={label}
                      onSelect={() => go(to)}
                      className={cn('flex items-center justify-between px-3 py-2 rounded text-sm cursor-pointer', 'text-text-primary')}
                    >
                      <span>{label}</span>
                      <kbd className={cn('text-[10px]', 'text-text-tertiary')}>{shortcut}</kbd>
                    </Command.Item>
                  ))}
                </Command.Group>

                {/* Recent runs */}
                {runs && runs.length > 0 && (
                  <Command.Group
                    heading="Recent Runs"
                    className={cn('px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider mt-2', 'text-text-tertiary')}
                  >
                    {runs.slice(0, 5).map((run) => (
                      <Command.Item
                        key={run.id}
                        value={`run ${run.id} ${run.branch ?? ''}`}
                        onSelect={() => go(`/runs/${run.id}`)}
                        className={cn('flex items-center justify-between px-3 py-2 rounded text-sm cursor-pointer', 'text-text-primary')}
                      >
                        <span className="font-mono text-xs">{run.id.slice(0, 8)}</span>
                        <span className="text-text-tertiary">{run.branch ?? '—'}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            )}
          </Command>
        </motion.div>
      </div>
    </>
  );
}
