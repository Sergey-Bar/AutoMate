import { useEffect, useState } from 'react';
import { Clock, Sparkles } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface QueryHistoryEntry {
  id: number;
  userQuery: string;
  generatedSql: string;
  resultCount: number | null;
  userId: string | null;
  createdAt: string;
}

interface SuggestedQueriesProps {
  onSelect: (query: string) => void;
}

// ── Static suggestions ───────────────────────────────────────────────────────

const SUGGESTED_QUERIES = [
  'Flaky tests this week',
  'Slowest tests (p95 > 10s)',
  'Tests that started failing recently',
  'Most common failure patterns',
  'Failed runs in the last 24 hours',
];

// ── Component ────────────────────────────────────────────────────────────────

export function SuggestedQueries({ onSelect }: SuggestedQueriesProps) {
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [_historyError, setHistoryError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchHistory() {
      try {
        const res = await fetch('/api/nl-query/history?limit=5');
        if (!res.ok) {
          setHistoryError(true);
          return;
        }
        const data = (await res.json()) as QueryHistoryEntry[];
        if (!cancelled) {
          setHistory(data);
        }
      } catch {
        if (!cancelled) setHistoryError(false); // silent fail — history is optional
      }
    }

    fetchHistory();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="px-3">
      {/* Recent queries from history */}
      {history.length > 0 && (
        <div className="mb-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-1 text-text-tertiary"
          >
            Recent Queries
          </div>
          {history.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onSelect(entry.userQuery)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-left hover:bg-white/5 cursor-pointer transition-colors text-text-primary"
            >
              <Clock size={12} className="text-text-tertiary" />
              <span className="flex-1 truncate">{entry.userQuery}</span>
              {entry.resultCount !== null && (
                <span
                  className="text-[10px] tabular-nums text-text-tertiary"
                >
                  {entry.resultCount} result{entry.resultCount !== 1 ? 's' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Static suggested queries */}
      <div>
        <div
          className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-1 text-text-tertiary"
        >
          Suggested Queries
        </div>
        {SUGGESTED_QUERIES.map((q) => (
          <button
            key={q}
            onClick={() => onSelect(q)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-left hover:bg-white/5 cursor-pointer transition-colors text-text-primary"
          >
            <Sparkles size={12} className="text-text-tertiary" />
            {q}
          </button>
        ))}
      </div>

      {/* Helper text */}
      <div
        className="text-[11px] px-2 mt-3 pb-1 text-text-tertiary"
      >
        Type your question and press Enter to search
      </div>
    </div>
  );
}

// Re-export for testing
export { SUGGESTED_QUERIES };
export type { QueryHistoryEntry };
