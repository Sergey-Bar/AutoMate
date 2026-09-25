import { useQuery } from '@tanstack/react-query';
import { useRef, useEffect } from 'react';
import { Skeleton } from '@/components/shared/Skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CodePeekProps {
  file: string;
  line?: number | null;
}

interface SourceResponse {
  content: string;
  language: string;
  file: string;
  line?: number;
  startLine: number;
}

export function CodePeek({ file, line }: CodePeekProps) {
  const highlightRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery<SourceResponse>({
    queryKey: ['test-source', file, line],
    queryFn: async () => {
      const params = new URLSearchParams({ file });
      if (line) params.set('line', String(line));
      const res = await fetch(`/api/tests/source?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to load source (${res.status})`);
      }
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Auto-scroll to highlighted line
  useEffect(() => {
    if (data && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [data]);

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <EmptyState
          title="Could not load source"
          description={error instanceof Error ? error.message : 'Unknown error'}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4">
        <EmptyState
          title="No source available"
          description="Source file path was not recorded for this test."
        />
      </div>
    );
  }

  const lines = data.content.split('\n');
  const startLine = data.startLine ?? 1;
  const targetLine = data.line;
  const vsCodeUrl = `vscode://file/${data.file}${targetLine ? `:${targetLine}` : ''}`;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle shrink-0">
        <span
          className="text-xs font-mono truncate text-text-secondary"
          title={data.file}
        >
          {data.file}
          {targetLine ? `:${targetLine}` : ''}
        </span>
        <a
          href={vsCodeUrl}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border-default transition-colors shrink-0 text-text-tertiary"
          title="Open in VS Code"
        >
          <ExternalLink size={11} />
          VS Code
        </a>
      </div>

      {/* Source code */}
      <div className="flex-1 overflow-auto">
        <pre className="text-xs leading-5 font-mono text-text-secondary" style={{ tabSize: 2 }}>
          {lines.map((content, i) => {
            const lineNum = startLine + i;
            const isTarget = targetLine === lineNum;
            return (
              <div
                key={lineNum}
                ref={isTarget ? highlightRef : undefined}
                className={cn(
                  'flex border-l-[3px] border-l-transparent',
                  isTarget && 'bg-fail-bg border-l-fail',
                )}
              >
                <span
                  className="inline-block w-12 pr-3 text-right select-none shrink-0 text-text-tertiary"
                >
                  {lineNum}
                </span>
                <span className="flex-1 whitespace-pre">{content}</span>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
