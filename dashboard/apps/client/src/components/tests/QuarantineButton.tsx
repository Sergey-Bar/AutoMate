import { useState } from 'react';
import { Shield, ShieldOff } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { showToast } from '@/lib/showToast';
import { cn } from '@/lib/utils';

interface QuarantineButtonProps {
  testTitle: string;
  testFile: string;
}

export function QuarantineButton({ testTitle, testFile }: QuarantineButtonProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: quarantined } = useQuery<Array<{ id: string; testTitle: string; testFile: string }>>({
    queryKey: ['quarantine'],
    queryFn: () => fetch('/api/quarantine').then((r) => r.json()),
    staleTime: 30_000,
  });

  const match = quarantined?.find((q) => q.testTitle === testTitle && q.testFile === testFile);

  const add = useMutation({
    mutationFn: () =>
      fetch('/api/quarantine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testTitle, testFile, reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quarantine'] });
      setShowInput(false);
      setReason('');
      showToast(`${testTitle} quarantined`);
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      fetch(`/api/quarantine/${match!.id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['quarantine'] }); showToast(`${testTitle} removed from quarantine`); },
  });

  if (match) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => remove.mutate()}
        icon={<ShieldOff size={13} />}
        title="Remove from quarantine"
        aria-label="Remove from quarantine"
        className="!text-[11px] !px-2 !py-1 !h-auto !text-flaky"
      >
        Quarantined
      </Button>
    );
  }

  if (showInput) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="px-2 py-0.5 rounded text-xs border border-border-default bg-transparent outline-none w-40 text-text-primary"
          onKeyDown={(e) => e.key === 'Enter' && add.mutate()}
          autoFocus
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => add.mutate()}
          style={{ color: '#000' }}
          className="!text-[11px] !px-2 !py-0.5 !h-auto bg-flaky"
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
      icon={<Shield size={13} />}
      title="Quarantine this test"
      aria-label="Quarantine this test"
      className="!text-[11px] !px-2 !py-1 !h-auto !text-text-secondary"
    >
      Quarantine
    </Button>
  );
}

interface QuarantineBadgeProps {
  quarantinedBy?: string | null;
}

/**
 * Shows an "Auto" badge for system-quarantined tests.
 * Used in the quarantine table to distinguish manual vs automatic quarantines.
 */
export function QuarantineBadge({ quarantinedBy }: QuarantineBadgeProps) {
  const isAuto = quarantinedBy === 'system';

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
        isAuto ? 'text-flaky' : 'text-running',
      )}
      style={{
        background: isAuto
          ? 'color-mix(in oklch, var(--color-flaky) 15%, transparent)'
          : 'color-mix(in oklch, var(--color-running) 15%, transparent)',
      }}
    >
      {isAuto ? 'Auto' : 'Manual'}
    </span>
  );
}
