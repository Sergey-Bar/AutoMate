import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertOctagon } from 'lucide-react';
import { useRunFingerprints } from '@/hooks/useRun';
import { useCategories, useFingerprintCategories, useAssignCategory } from '@/hooks/useCategories';
import type { TestWithResults } from '@/lib/types';

interface FailureFingerprintsProps {
  runId: string;
  tests: TestWithResults[];
  onSelectTest?: (testId: string) => void;
}

export function FailureFingerprints({ runId, tests, onSelectTest }: FailureFingerprintsProps) {
  const { data, isLoading } = useRunFingerprints(runId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: categories } = useCategories();
  const { data: fpCats } = useFingerprintCategories();
  const assignCategory = useAssignCategory();

  if (isLoading) {
    return (
      <div className="px-4 py-2">
        <div className="h-6 w-48 rounded animate-pulse bg-bg-elevated" />
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  const totalAffected = data.reduce((sum, g) => sum + g.count, 0);
  const N = data.length;

  return (
    <div
      className="mx-4 my-3 rounded-lg border overflow-hidden"
      style={{
        borderColor: 'color-mix(in oklch, var(--color-fail) 30%, transparent)',
        background: 'color-mix(in oklch, var(--color-fail) 5%, var(--color-bg-surface))',
      }}
    >
      {/* Summary header */}
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-fail">
        <AlertOctagon size={13} className="shrink-0" />
        <span>
          {N} unique error{N === 1 ? '' : 's'} caused {totalAffected} failure{totalAffected === 1 ? '' : 's'}
        </span>
      </div>

      {/* Per-fingerprint rows */}
      <div className="border-t" style={{ borderColor: 'color-mix(in oklch, var(--color-fail) 15%, transparent)' }}>
        {data.map((group) => {
          const isOpen = expanded === group.fingerprint;
          const affectedTests = tests.filter((t) => group.testIds.includes(t.id));

          return (
            <div
              key={group.fingerprint}
              className="border-b last:border-b-0"
              style={{ borderColor: 'color-mix(in oklch, var(--color-fail) 10%, transparent)' }}
            >
              {/* Collapsible header */}
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : group.fingerprint)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-opacity hover:opacity-80"
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
                ) : (
                  <ChevronRight size={12} className="shrink-0 text-text-tertiary" />
                )}
                {isOpen ? (
                  <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
                ) : (
                  <ChevronRight size={12} className="shrink-0 text-text-tertiary" />
                )}
                <span
                  className="flex-1 truncate font-mono text-text-primary"
                  title={group.errorMessage}
                >
                  {group.errorMessage.length > 90
                    ? group.errorMessage.slice(0, 90) + '…'
                    : group.errorMessage}
                </span>
                <span
                  className="shrink-0 ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    background: 'color-mix(in oklch, var(--color-fail) 15%, transparent)',
                    color: 'var(--color-fail)',
                  }}
                >
                  {group.count} test{group.count === 1 ? '' : 's'}
                </span>
                {(() => {
                  const currentCategoryId = fpCats?.find((fc) => fc.fingerprint === group.fingerprint)?.categoryId ?? '';
                  return (
                    <select
                      value={currentCategoryId}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => assignCategory.mutate({ fingerprint: group.fingerprint, categoryId: e.target.value || null })}
                      className="text-xs px-2 py-1 rounded border border-border-default text-text-secondary bg-transparent outline-none"
                      aria-label="Defect category"
                    >
                      <option value="">— uncategorized —</option>
                      {(categories ?? []).map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  );
                })()}
              </button>

              {/* Expanded test list */}
              {isOpen && (
                <div
                  className="pl-7 pr-3 pb-2 flex flex-col gap-0.5"
                  style={{ borderTop: '1px solid color-mix(in oklch, var(--color-fail) 10%, transparent)' }}
                >
                  {affectedTests.length === 0 ? (
                    <p className="text-[11px] py-1 text-text-tertiary">
                      Test details not loaded yet
                    </p>
                  ) : (
                    affectedTests.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onSelectTest?.(t.id)}
                        className="flex items-center gap-1.5 py-0.5 text-[11px] text-left text-text-secondary transition-opacity hover:opacity-70"
                      >
                        <span className="truncate">{t.title}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
