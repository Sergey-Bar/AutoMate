import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SettingsSection, SettingRow } from './SettingsSection';

interface RetentionConfig {
  testResultDays: number;
  nlQueryHistoryDays: number;
  attachmentDays: number;
  trendsDays: number;
  enabled: boolean;
}

interface CleanupResult {
  deletedRuns: number;
  deletedResults: number;
  deletedNlQueries: number;
  deletedAttachments: number;
  durationMs: number;
}

interface DbStats {
  sizeBytes: number;
  sizeMB: string;
  pageCount: number;
  pageSize: number;
}

const DEFAULT_CONFIG: RetentionConfig = {
  testResultDays: 90,
  nlQueryHistoryDays: 30,
  attachmentDays: 60,
  trendsDays: -1,
  enabled: false,
};

export function DataRetentionSettings() {
  const qc = useQueryClient();
  const [form, setForm] = useState<RetentionConfig>(DEFAULT_CONFIG);

  const { data: config } = useQuery<RetentionConfig>({
    queryKey: ['data-retention-config'],
    queryFn: () => fetch('/api/settings/data-retention').then((r) => r.json()),
  });

  const { data: stats } = useQuery<DbStats>({
    queryKey: ['db-stats'],
    queryFn: () => fetch('/api/settings/db-stats').then((r) => r.json()),
  });

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const saveConfig = useMutation({
    mutationFn: () =>
      fetch('/api/settings/data-retention', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to save');
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data-retention-config'] });
      toast.success('Retention policy updated');
    },
    onError: () => toast.error('Failed to update retention policy'),
  });

  const toggleEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      fetch('/api/settings/data-retention', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, enabled }),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to toggle');
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data-retention-config'] });
      toast.success(config?.enabled ? 'Automatic cleanup disabled' : 'Automatic cleanup enabled');
    },
    onError: () => toast.error('Failed to update retention policy'),
  });

  const runCleanup = useMutation({
    mutationFn: () =>
      fetch('/api/settings/data-retention/run', { method: 'POST' }).then((r) => {
        if (!r.ok) throw new Error('Cleanup failed');
        return r.json() as Promise<CleanupResult>;
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['db-stats'] });
      qc.invalidateQueries({ queryKey: ['data-retention-config'] });
      toast.success(
        `Cleanup complete in ${result.durationMs}ms — ${result.deletedRuns} runs, ${result.deletedResults} results, ${result.deletedNlQueries} queries, ${result.deletedAttachments} attachments removed`,
      );
    },
    onError: () => toast.error('Cleanup failed'),
  });

  const isEnabled = config?.enabled ?? false;

  const hasChanges =
    config &&
    (form.testResultDays !== config.testResultDays ||
      form.nlQueryHistoryDays !== config.nlQueryHistoryDays ||
      form.attachmentDays !== config.attachmentDays ||
      form.trendsDays !== config.trendsDays);

  function updateField(field: keyof Omit<RetentionConfig, 'enabled'>, value: string) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setForm((prev) => ({ ...prev, [field]: num }));
    }
  }

  return (
    <div className="space-y-4">
      {/* Retention Status */}
      <SettingsSection title="Data Retention">
        {!isEnabled && (
          <div className="flex items-start gap-2 px-4 py-3 border-b border-border-subtle bg-amber-500/10">
            <Clock size={14} className="shrink-0 mt-0.5 text-amber-500" />
            <p className="text-xs text-amber-600">
              Automatic cleanup is disabled. Old data will accumulate indefinitely.
            </p>
          </div>
        )}
        {isEnabled && (
          <div className="flex items-start gap-2 px-4 py-3 border-b border-border-subtle bg-emerald-500/10">
            <Clock size={14} className="shrink-0 mt-0.5 text-emerald-500" />
            <p className="text-xs text-emerald-600">
              Automatic cleanup is active. Data older than configured thresholds will be removed.
            </p>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {isEnabled ? 'Enabled' : 'Disabled'}
            </p>
            <p className="text-xs text-text-tertiary">
              Automatically delete data older than retention thresholds
            </p>
          </div>
          <Button
            size="sm"
            variant={isEnabled ? 'danger' : 'primary'}
            loading={toggleEnabled.isPending}
            onClick={() => toggleEnabled.mutate(!isEnabled)}
          >
            {isEnabled ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </SettingsSection>

      {/* Retention Periods */}
      <SettingsSection title="Retention Periods">
        <SettingRow label="Test Results" description="Days to keep test runs, results, and suites">
          <Input
            size="sm"
            type="number"
            min={1}
            value={form.testResultDays}
            onChange={(e) => updateField('testResultDays', e.target.value)}
            className="w-20 text-right"
          />
        </SettingRow>
        <SettingRow label="NL Query History" description="Days to keep natural language query logs">
          <Input
            size="sm"
            type="number"
            min={1}
            value={form.nlQueryHistoryDays}
            onChange={(e) => updateField('nlQueryHistoryDays', e.target.value)}
            className="w-20 text-right"
          />
        </SettingRow>
        <SettingRow label="Attachments" description="Days to keep screenshots, videos, and traces">
          <Input
            size="sm"
            type="number"
            min={1}
            value={form.attachmentDays}
            onChange={(e) => updateField('attachmentDays', e.target.value)}
            className="w-20 text-right"
          />
        </SettingRow>
        <SettingRow label="Trend Data" description="Days to keep trend rollups. Use -1 for forever">
          <Input
            size="sm"
            type="number"
            min={-1}
            value={form.trendsDays}
            onChange={(e) => updateField('trendsDays', e.target.value)}
            className="w-20 text-right"
          />
        </SettingRow>
        <div className="flex justify-end px-4 py-3">
          <Button
            size="sm"
            loading={saveConfig.isPending}
            disabled={!hasChanges}
            onClick={() => saveConfig.mutate()}
          >
            Save Changes
          </Button>
        </div>
      </SettingsSection>

      {/* Database Stats */}
      <SettingsSection title="Database">
        <SettingRow label="Database Size" description="Current SQLite database file size">
          <p className="text-sm font-medium text-text-primary">{stats?.sizeMB ?? '—'} MB</p>
        </SettingRow>
        <SettingRow label="Pages" description="Total database pages allocated">
          <p className="text-sm font-medium text-text-primary">
            {stats?.pageCount?.toLocaleString() ?? '—'}
          </p>
        </SettingRow>
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Run Cleanup Now</p>
            <p className="text-xs text-text-tertiary">
              Manually trigger data retention cleanup based on current settings
            </p>
          </div>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 size={11} />}
            loading={runCleanup.isPending}
            onClick={() => runCleanup.mutate()}
          >
            Run Cleanup
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}
