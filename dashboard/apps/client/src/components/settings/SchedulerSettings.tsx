import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Clock } from 'lucide-react';
import { Toggle } from '@/components/ui/Toggle';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function SchedulerSettings() {
  const queryClient = useQueryClient();
  const [newCron, setNewCron] = useState('');

  const { data: schedules } = useQuery<Array<{ id: string; cronExpr: string; enabled: boolean; lastRunAt?: string }>>({
    queryKey: ['schedules'],
    queryFn: () => fetch('/api/schedules').then((r) => r.json()),
    staleTime: 30_000,
  });

  const createSchedule = useMutation({
    mutationFn: () =>
      fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronExpr: newCron, enabled: true }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      setNewCron('');
    },
  });

  const toggleSchedule = useMutation({
    mutationFn: (args: { id: string; enabled: boolean }) =>
      fetch(`/api/schedules/${args.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: args.enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  });

  const deleteSchedule = useMutation({
    mutationFn: (id: string) => fetch(`/api/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  });

  return (
    <div className="rounded-xl border border-border-default overflow-hidden">
      <div
        className="px-4 py-2.5 border-b border-border-subtle text-[11px] font-semibold uppercase tracking-wider flex items-center gap-2 bg-bg-surface text-text-tertiary"
      >
        <Clock size={12} />
        Scheduler
      </div>
      <div className="bg-bg-surface">
        {schedules?.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between px-4 py-3 border-b border-border-subtle last:border-0"
          >
            <div className="flex items-center gap-3">
              <Toggle
                checked={s.enabled}
                onChange={(v) => toggleSchedule.mutate({ id: s.id, enabled: v })}
              />
              <span className="font-mono text-sm text-text-primary">{s.cronExpr}</span>
            </div>
            <div className="flex items-center gap-2">
              {s.lastRunAt && (
                <span className="text-[11px] text-text-tertiary">
                  Last: {new Date(s.lastRunAt).toLocaleString()}
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={() => deleteSchedule.mutate(s.id)} aria-label="Delete schedule">
                <Trash2 size={13} className="text-fail" />
              </Button>
            </div>
          </div>
        ))}

        {/* Add new schedule */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle">
          <Input
            size="sm"
            value={newCron}
            onChange={(e) => setNewCron(e.target.value)}
            placeholder="*/30 * * * * (cron expression)"
            className="flex-1 font-mono"
            onKeyDown={(e) => e.key === 'Enter' && newCron.trim() && createSchedule.mutate()}
          />
          <Button size="sm" icon={<Plus size={13} />} onClick={() => newCron.trim() && createSchedule.mutate()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
