import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { SettingsSection, SettingRow } from './SettingsSection';

export function PRIntegrationSettings() {
  const qc = useQueryClient();
  const [ghToken, setGhToken] = useState('');
  const [ghOwner, setGhOwner] = useState('');
  const [ghRepo, setGhRepo] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [prComments, setPrComments] = useState(true);
  const [checkRuns, setCheckRuns] = useState(false);
  const [ignoreFlakyInComments, setIgnoreFlakyInComments] = useState(false);

  const { data: config } = useQuery<Record<string, Record<string, unknown>>>({
    queryKey: ['integrations-config'],
    queryFn: () => fetch('/api/integrations/config').then((r) => r.json()),
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch('/api/integrations/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations-config'] });
      toast.success('PR integration config saved');
    },
    onError: () => toast.error('Failed to save'),
  });

  const testGitHub = useMutation({
    mutationFn: () => fetch('/api/integrations/test/github', { method: 'POST' }).then((r) => {
      if (!r.ok) throw new Error('Test failed');
      return r.json();
    }),
    onSuccess: (data: Record<string, string>) => toast.success(`Connected to ${data.repo}`),
    onError: () => toast.error('GitHub test failed — check token and repo'),
  });

  function handleSave() {
    saveMutation.mutate({
      github: {
        token: ghToken || undefined,
        owner: ghOwner || undefined,
        repo: ghRepo || undefined,
        enabled: true,
        prComments,
        checkRuns,
        defaultBaseBranch: baseBranch || undefined,
        ignoreFlakyInComments,
        commitStatus: true,
      },
    });
  }

  return (
    <SettingsSection title="PR Integration">
      {/* GitHub Connection */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <p className="text-sm font-medium mb-2 text-text-primary">GitHub Connection</p>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <Input
            size="sm"
            type="password"
            value={ghToken}
            onChange={(e) => setGhToken(e.target.value)}
            placeholder={config?.github?.token ? '••••••••' : 'ghp_…'}
            className="font-mono"
          />
          <Input
            size="sm"
            value={ghOwner}
            onChange={(e) => setGhOwner(e.target.value)}
            placeholder={(config?.github?.owner as string) ?? 'Owner'}
          />
          <Input
            size="sm"
            value={ghRepo}
            onChange={(e) => setGhRepo(e.target.value)}
            placeholder={(config?.github?.repo as string) ?? 'Repo'}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={<Send size={11} />} onClick={() => testGitHub.mutate()}>
            Test Connection
          </Button>
        </div>
        <p className="text-[11px] mt-1 text-text-tertiary">
          GitHub token needs repo scope for PR comments and check runs
        </p>
      </div>

      {/* PR Settings */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <p className="text-sm font-medium mb-3 text-text-primary">PR Settings</p>
        <Input
          size="sm"
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          placeholder={(config?.github?.defaultBaseBranch as string) ?? 'main'}
          label="Default Base Branch"
          hint="Branch to compare PR test results against"
        />
      </div>

      {/* Toggles */}
      <SettingRow label="PR Comments" description="Post comparison results as PR comments with deduplication">
        <Toggle checked={prComments} onChange={setPrComments} size="sm" />
      </SettingRow>

      <SettingRow label="Check Runs" description="Create GitHub Check Runs with quality gate status">
        <Toggle checked={checkRuns} onChange={setCheckRuns} size="sm" />
      </SettingRow>

      <SettingRow label="Ignore Flaky in Comments" description="Exclude quarantined tests from new failure count in PR comments">
        <Toggle checked={ignoreFlakyInComments} onChange={setIgnoreFlakyInComments} size="sm" />
      </SettingRow>

      {/* Save */}
      <div className="px-4 py-3">
        <Button size="sm" onClick={handleSave}>
          Save
        </Button>
      </div>
    </SettingsSection>
  );
}
