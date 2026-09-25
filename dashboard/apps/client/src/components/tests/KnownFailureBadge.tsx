import { useState } from 'react';
import { Bug, BugOff } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { showToast } from '@/lib/showToast';

interface KnownFailureBadgeProps {
  testTitle: string;
  testFile: string;
}

export function KnownFailureBadge({ testTitle, testFile }: KnownFailureBadgeProps) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: knownFailures } = useQuery<Array<{ id: string; testTitle: string; testFile: string; comment?: string }>>({
    queryKey: ['known-failures'],
    queryFn: () => fetch('/api/known-failures').then((r) => r.json()),
    staleTime: 30_000,
  });

  const match = knownFailures?.find((kf) => kf.testTitle === testTitle && kf.testFile === testFile);

  const add = useMutation({
    mutationFn: () =>
      fetch('/api/known-failures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testTitle, testFile, comment }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['known-failures'] });
      setShowInput(false);
      setComment('');
      showToast(`${testTitle} marked as known failure`);
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      fetch(`/api/known-failures/${match!.id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['known-failures'] }); showToast(`${testTitle} unmarked as known failure`); },
  });

  if (match) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => remove.mutate()}
        icon={<BugOff size={13} />}
        title={`Known failure: ${match.comment ?? 'No comment'}`}
        aria-label="Remove known failure annotation"
        className="!text-[11px] !px-2 !py-1 !h-auto !text-fail"
      >
        Known Failure
      </Button>
    );
  }

  if (showInput) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Comment (optional)"
          className="px-2 py-0.5 rounded text-xs border border-border-default bg-transparent outline-none w-40 text-text-primary"
          onKeyDown={(e) => e.key === 'Enter' && add.mutate()}
          autoFocus
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => add.mutate()}
          className="!text-[11px] !px-2 !py-0.5 !h-auto bg-fail text-white"
        >
          Confirm
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowInput(false)}
          className="!text-[11px] !px-1 !h-auto !text-text-tertiary"
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setShowInput(true)}
      icon={<Bug size={13} />}
      title="Mark as known failure"
      aria-label="Mark as known failure"
      className="!text-[11px] !px-2 !py-1 !h-auto !text-text-secondary"
    >
      Known Failure
    </Button>
  );
}
