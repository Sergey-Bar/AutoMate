import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, Copy } from 'lucide-react';

interface CodegenPanelProps {
  isRunning: boolean;
}

export function CodegenPanel({ isRunning }: CodegenPanelProps) {
  const qc = useQueryClient();
  const [savePath, setSavePath] = useState('tests/recorded.spec.ts');

  // Poll output while running
  const { data: outputData } = useQuery<{ output: string }>({
    queryKey: ['codegen-output'],
    queryFn: () => fetch('/api/codegen/output').then((r) => r.json()),
    refetchInterval: isRunning ? 1000 : false,
    staleTime: 0,
  });

  const code = outputData?.output ?? '';

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/codegen/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: code, filePath: savePath }),
      });
      if (!res.ok) throw new Error('Save failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['codegen-output'] });
      toast.success(`Saved to ${savePath}`);
    },
    onError: () => toast.error('Failed to save'),
  });

  function handleCopy() {
    navigator.clipboard.writeText(code);
    toast.success('Copied to clipboard');
  }

  return (
    <div
      className="flex flex-col h-full rounded-xl border border-border-default overflow-hidden bg-bg-surface"
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-border-subtle shrink-0"
      >
        <p className="text-xs font-semibold text-text-primary">
          Generated Code
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={!code}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-text-secondary transition-colors disabled:opacity-40"
            title="Copy to clipboard"
          >
            <Copy size={12} /> Copy
          </button>

          <div className="flex items-center gap-1">
            <input
              type="text"
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              className="px-2 py-1 rounded text-[11px] font-mono border border-border-subtle w-44 bg-bg-elevated text-text-primary"
              placeholder="tests/my-test.spec.ts"
            />
            <button
              onClick={() =>
                toast.promise(saveMutation.mutateAsync(), {
                  loading: 'Saving…',
                  success: 'Saved',
                  error: 'Failed',
                })
              }
              disabled={!code || saveMutation.isPending}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-running text-white transition-colors disabled:opacity-40"
            >
              <Save size={11} /> Save
            </button>
          </div>
        </div>
      </div>

      {/* Code display */}
      <div className="flex-1 overflow-auto p-4">
        {code ? (
          <pre
            className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-text-primary"
          >
            {code}
          </pre>
        ) : (
          <div
            className="flex items-center justify-center h-full text-xs text-text-tertiary"
          >
            {isRunning
              ? 'Recording… interact with the browser to generate code.'
              : 'Click "Start Recording" to begin generating test code.'}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div
        className="flex items-center gap-2 px-4 py-1.5 border-t border-border-subtle text-[10px] text-text-tertiary"
      >
        <span className={isRunning ? 'text-green-400' : ''}>
          {isRunning ? '● Recording' : '○ Idle'}
        </span>
        <span>·</span>
        <span>{code.split('\n').length} lines</span>
      </div>
    </div>
  );
}
