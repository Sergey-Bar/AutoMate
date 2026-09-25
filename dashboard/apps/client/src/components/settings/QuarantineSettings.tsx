import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SettingsSection, SettingRow } from './SettingsSection';

export function QuarantineSettings() {
  const queryClient = useQueryClient();
  const { data: cfg } = useQuery<{ flakyThreshold: number; lookbackRuns: number }>({
    queryKey: ['auto-quarantine-config'],
    queryFn: () => fetch('/api/settings/auto-quarantine').then((r) => r.json()),
  });
  const [flakyThreshold, setFlakyThreshold] = useState<number>(cfg?.flakyThreshold ?? 3);
  const [lookbackRuns, setLookbackRuns] = useState<number>(cfg?.lookbackRuns ?? 10);

  useEffect(() => {
    if (cfg?.flakyThreshold !== undefined) setFlakyThreshold(cfg.flakyThreshold);
    if (cfg?.lookbackRuns !== undefined) setLookbackRuns(cfg.lookbackRuns);
  }, [cfg?.flakyThreshold, cfg?.lookbackRuns]);

  const save = useMutation({
    mutationFn: () =>
      fetch('/api/settings/auto-quarantine', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flakyThreshold, lookbackRuns }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auto-quarantine-config'] });
      toast.success('Auto-quarantine settings saved');
    },
  });

  return (
    <SettingsSection title="Auto-Quarantine">
      <SettingRow label="Flaky Threshold" description="Number of times a test must flake to be auto-quarantined">
        <Input
          size="sm"
          type="number"
          min={1}
          value={flakyThreshold}
          onChange={(e) => setFlakyThreshold(Number(e.target.value))}
          style={{ width: '6rem' }}
        />
      </SettingRow>
      <SettingRow label="Lookback Runs" description="Number of recent runs to check for flaky behavior">
        <Input
          size="sm"
          type="number"
          min={1}
          value={lookbackRuns}
          onChange={(e) => setLookbackRuns(Number(e.target.value))}
          style={{ width: '6rem' }}
        />
      </SettingRow>
      <div className="flex justify-end px-4 py-3">
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </SettingsSection>
  );
}
