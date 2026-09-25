import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SettingsSection, SettingRow } from './SettingsSection';

export function QualityGateSettings() {
  const queryClient = useQueryClient();
  const { data: cfg } = useQuery<{ passRateThreshold: number; maxDurationMs: number | null; maxFlakyCount: number | null }>({
    queryKey: ['gate-config'],
    queryFn: () => fetch('/api/gate-config').then((r) => r.json()),
  });
  const [threshold, setThreshold] = useState<number>(cfg?.passRateThreshold ?? 100);
  const [maxDuration, setMaxDuration] = useState<string>(cfg?.maxDurationMs?.toString() ?? '');
  const [maxFlaky, setMaxFlaky] = useState<string>(cfg?.maxFlakyCount?.toString() ?? '');

  useEffect(() => {
    if (cfg?.passRateThreshold !== undefined) setThreshold(cfg.passRateThreshold);
    if (cfg?.maxDurationMs !== undefined) setMaxDuration(cfg.maxDurationMs?.toString() ?? '');
    if (cfg?.maxFlakyCount !== undefined) setMaxFlaky(cfg.maxFlakyCount?.toString() ?? '');
  }, [cfg?.passRateThreshold, cfg?.maxDurationMs, cfg?.maxFlakyCount]);

  const save = useMutation({
    mutationFn: () =>
      fetch('/api/gate-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passRateThreshold: threshold, maxDurationMs: maxDuration ? Number(maxDuration) : null, maxFlakyCount: maxFlaky ? Number(maxFlaky) : null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gate-config'] });
      toast.success('Quality gate saved');
    },
  });

  return (
    <SettingsSection title="Quality Gate">
      <SettingRow label="Pass Rate Threshold" description="Minimum pass rate % for a run to pass the quality gate">
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={{ width: '6rem' }}
          />
          <span className="text-sm text-text-tertiary">%</span>
        </div>
      </SettingRow>
      <SettingRow label="Max Duration (ms)" description="Fail gate if run duration exceeds this. Leave empty to skip.">
        <Input
          size="sm"
          type="number"
          min={0}
          value={maxDuration}
          onChange={(e) => setMaxDuration(e.target.value)}
          placeholder="No limit"
          style={{ width: '8rem' }}
        />
      </SettingRow>
      <SettingRow label="Max Flaky Count" description="Fail gate if flaky test count exceeds this. Leave empty to skip.">
        <Input
          size="sm"
          type="number"
          min={0}
          value={maxFlaky}
          onChange={(e) => setMaxFlaky(e.target.value)}
          placeholder="No limit"
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
