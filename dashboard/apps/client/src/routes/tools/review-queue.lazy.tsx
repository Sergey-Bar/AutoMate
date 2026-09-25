import { createLazyFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { CheckSquare, XSquare, Copy, Download, Edit2, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FeatureGate } from '@/components/FeatureGate';
import { FeatureDisabledPage } from '@/components/shared/FeatureDisabledPage';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { showToast } from '@/lib/showToast';

export const Route = createLazyFileRoute('/tools/review-queue')({
  component: ReviewQueuePage,
});

interface Suggestion {
  id: string;
  sessionId: string | null;
  sourceType: string;
  sourceMetadata: Record<string, unknown>;
  status: 'draft' | 'accepted' | 'rejected' | 'edited';
  originalContent: string;
  editedContent: string | null;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

function useSuggestions(status?: string) {
  return useQuery<Suggestion[]>({
    queryKey: ['generated-suggestions', status],
    queryFn: async () => {
      const url = new URL('/api/generated-test-suggestions', window.location.origin);
      if (status && status !== 'all') {
        url.searchParams.set('status', status);
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch suggestions');
      return res.json();
    },
  });
}

function useUpdateSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, editedContent }: { id: string; status: string; editedContent?: string }) => {
      const res = await fetch(`/api/generated-test-suggestions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, editedContent }),
      });
      if (!res.ok) throw new Error('Failed to update suggestion');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['generated-suggestions'] });
    },
    onError: (err) => {
      showToast(err instanceof Error ? err.message : 'Failed to update', 'error');
    },
  });
}

function ReviewQueuePage() {
  return (
    <FeatureGate flag="ai-test-gen-v2" fallback={<FeatureDisabledPage feature="AI Test Generation v2" />}>
      <ReviewQueueContent />
    </FeatureGate>
  );
}

function ReviewQueueContent() {
  const [filter, setFilter] = useState('draft');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: suggestions, isLoading } = useSuggestions(filter);
  const selected = useMemo(() => suggestions?.find(s => s.id === selectedId), [suggestions, selectedId]);

  return (
    <div className="flex h-full overflow-hidden bg-bg-canvas">
      {/* Left List */}
      <div className="w-1/3 min-w-[300px] border-r border-border-subtle flex flex-col bg-bg-surface">
        <div className="p-4 border-b border-border-subtle shrink-0">
          <h1 className="text-xl font-semibold mb-4 text-text-primary">Review Queue</h1>
          <div className="flex gap-2 bg-bg-subtle p-1 rounded-md">
            {['all', 'draft', 'accepted', 'rejected', 'edited'].map(f => (
              <button
                key={f}
                onClick={() => { setFilter(f); setSelectedId(null); }}
                className={cn(
                  'px-3 py-1.5 text-sm rounded capitalize flex-1 transition-colors',
                  filter === f ? 'bg-bg-surface shadow-sm text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {isLoading ? (
            <div className="p-4 text-center text-text-tertiary">Loading...</div>
          ) : !suggestions?.length ? (
            <EmptyState
              icon={<CheckSquare className="w-12 h-12 text-border-subtle" />}
              title="Queue is empty"
              description={`No ${filter === 'all' ? '' : filter} test suggestions found.`}
            />
          ) : (
            suggestions.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  'w-full text-left p-3 rounded-lg border transition-all',
                  selectedId === s.id
                    ? 'border-border-focus bg-bg-subtle'
                    : 'border-border-subtle hover:border-border-base bg-bg-surface'
                )}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase', 
                      s.status === 'accepted' ? 'bg-pass/10 text-pass border border-pass/20' :
                      s.status === 'rejected' ? 'bg-fail/10 text-fail border border-fail/20' :
                      s.status === 'edited' ? 'bg-flaky/10 text-flaky border border-flaky/20' : 
                      'bg-bg-subtle text-text-secondary border border-border-subtle'
                    )}>
                      {s.status}
                    </span>
                    <span className="text-xs text-text-tertiary font-mono">{s.sourceType}</span>
                  </div>
                  <span className="text-xs text-text-tertiary">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-sm text-text-secondary font-mono truncate">
                  {s.sessionId || (typeof s.sourceMetadata?.prUrl === 'string' ? s.sourceMetadata.prUrl : s.id)}
                </div>
                {s.warnings?.length > 0 && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-fail">
                    <AlertTriangle size={12} />
                    {s.warnings.length} warning{s.warnings.length > 1 ? 's' : ''}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right Detail Panel */}
      <div className="flex-1 bg-bg-canvas flex flex-col min-w-0">
        {selected ? (
          <SuggestionDetail suggestion={selected} onAction={() => setSelectedId(null)} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-tertiary">
            Select a suggestion to review
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionDetail({ suggestion, onAction }: { suggestion: Suggestion; onAction: () => void }) {
  const { mutate, isPending } = useUpdateSuggestion();
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(suggestion.editedContent || suggestion.originalContent);

  const displayContent = isEditing ? editVal : (suggestion.editedContent || suggestion.originalContent);

  const handleAction = (status: string, content?: string) => {
    mutate(
      { id: suggestion.id, status, editedContent: content },
      { onSuccess: () => {
        showToast(`Suggestion marked as ${status}`, 'success');
        if (status !== 'edited') onAction();
      } }
    );
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(displayContent).then(() => {
      showToast('Copied to clipboard', 'success');
    });
  };

  const downloadContent = () => {
    const blob = new Blob([displayContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `suggestion-${suggestion.id.substring(0, 8)}.spec.ts`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    showToast('Downloaded', 'success');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Detail Header */}
      <div className="p-6 border-b border-border-subtle bg-bg-surface flex justify-between items-start shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-lg font-semibold text-text-primary">Review Suggestion</h2>
            <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase', 
              suggestion.status === 'accepted' ? 'bg-pass/10 text-pass border border-pass/20' :
              suggestion.status === 'rejected' ? 'bg-fail/10 text-fail border border-fail/20' :
              suggestion.status === 'edited' ? 'bg-flaky/10 text-flaky border border-flaky/20' : 
              'bg-bg-subtle text-text-secondary border border-border-subtle'
            )}>
              {suggestion.status}
            </span>
          </div>
          <div className="text-sm text-text-secondary flex items-center gap-4">
            <span className="flex items-center gap-1"><Clock size={14}/> {new Date(suggestion.createdAt).toLocaleString()}</span>
            <span className="font-mono text-xs bg-bg-subtle px-1.5 py-0.5 rounded">ID: {suggestion.id.substring(0,8)}...</span>
            <span className="font-mono text-xs bg-bg-subtle px-1.5 py-0.5 rounded">Source: {suggestion.sourceType}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {suggestion.status === 'draft' && (
            <>
              <Button variant="primary" size="sm" onClick={() => handleAction('accepted')} disabled={isPending} className="bg-pass hover:bg-pass/90 text-white">
                <CheckCircle2 size={16} className="mr-2" /> Accept
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleAction('rejected')} disabled={isPending} className="text-fail border-fail/50 hover:bg-fail/10">
                <XSquare size={16} className="mr-2" /> Reject
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Warnings */}
      {suggestion.warnings?.length > 0 && (
        <div className="p-4 bg-fail/10 border-b border-fail/20 shrink-0">
          <h3 className="text-sm font-semibold text-fail flex items-center gap-2 mb-2">
            <AlertTriangle size={16} /> Warnings
          </h3>
          <ul className="list-disc list-inside text-sm text-fail/90 ml-4 space-y-1">
            {suggestion.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col p-6">
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h3 className="text-sm font-semibold text-text-primary">
            {isEditing ? 'Edit Content' : 'Generated Content'}
          </h3>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={copyToClipboard} title="Copy to clipboard">
              <Copy size={16} />
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadContent} title="Download as file">
              <Download size={16} />
            </Button>
            {!isEditing ? (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                <Edit2 size={16} className="mr-2" /> Edit
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setIsEditing(false); setEditVal(suggestion.editedContent || suggestion.originalContent); }}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={() => { setIsEditing(false); handleAction('edited', editVal); }} disabled={isPending}>
                  Save Edit
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-[#1e1e1e] rounded-lg overflow-hidden border border-border-subtle relative shadow-inner">
          {isEditing ? (
            <textarea
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              className="w-full h-full p-4 bg-transparent text-gray-300 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-border-focus"
              spellCheck={false}
            />
          ) : (
            <div className="w-full h-full p-4 overflow-auto text-gray-300 font-mono text-sm whitespace-pre">
              {displayContent}
            </div>
          )}
        </div>
        
        {!isEditing && suggestion.editedContent && (
          <div className="mt-4 shrink-0">
             <h3 className="text-sm font-semibold text-text-primary mb-2">Original Content</h3>
             <div className="max-h-48 overflow-auto bg-[#1e1e1e]/60 rounded-lg border border-border-subtle p-4 text-gray-400 font-mono text-xs whitespace-pre opacity-70">
                {suggestion.originalContent}
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
