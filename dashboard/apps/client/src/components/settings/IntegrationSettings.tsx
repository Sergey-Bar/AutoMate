import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SettingsSection } from './SettingsSection';

export function IntegrationSettings() {
  const qc = useQueryClient();
  const [slackUrl, setSlackUrl] = useState('');
  const [teamsUrl, setTeamsUrl] = useState('');
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraProject, setJiraProject] = useState('');
  const [ghToken, setGhToken] = useState('');
  const [ghOwner, setGhOwner] = useState('');
  const [ghRepo, setGhRepo] = useState('');

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
      toast.success('Integration config saved');
    },
    onError: () => toast.error('Failed to save'),
  });

  const testSlack = useMutation({
    mutationFn: () => fetch('/api/integrations/test/slack', { method: 'POST' }).then((r) => {
      if (!r.ok) throw new Error('Test failed');
      return r.json();
    }),
    onSuccess: () => toast.success('Test message sent to Slack'),
    onError: () => toast.error('Slack test failed — check webhook URL'),
  });

  const testGitHub = useMutation({
    mutationFn: () => fetch('/api/integrations/test/github', { method: 'POST' }).then((r) => {
      if (!r.ok) throw new Error('Test failed');
      return r.json();
    }),
    onSuccess: (data: Record<string, string>) => toast.success(`Connected to ${data.repo}`),
    onError: () => toast.error('GitHub test failed — check token and repo'),
  });

  return (
    <SettingsSection title="Integrations">
      {/* Slack */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <p className="text-sm font-medium mb-2 text-text-primary">Slack</p>
        <div className="flex items-center gap-2 mb-2">
          <Input
            size="sm"
            value={slackUrl}
            onChange={(e) => setSlackUrl(e.target.value)}
            placeholder={(config?.slack?.webhookUrl as string) ?? 'https://hooks.slack.com/services/…'}
            className="flex-1 font-mono"
          />
          <Button size="sm" onClick={() => saveMutation.mutate({ slack: { webhookUrl: slackUrl || undefined, enabled: true, notifyOn: ['all'] } } as Record<string, unknown>)}>
            Save
          </Button>
          <Button variant="secondary" size="sm" icon={<Send size={11} />} onClick={() => testSlack.mutate()}>
            Test
          </Button>
        </div>
        <p className="text-[11px] text-text-tertiary">Sends run summary to Slack on completion</p>
      </div>

      {/* Teams */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <p className="text-sm font-medium mb-2 text-text-primary">Microsoft Teams</p>
        <div className="flex items-center gap-2 mb-2">
          <Input
            size="sm"
            value={teamsUrl}
            onChange={(e) => setTeamsUrl(e.target.value)}
            placeholder={(config?.teams?.webhookUrl as string) ?? 'https://outlook.office.com/webhook/…'}
            className="flex-1 font-mono"
          />
          <Button size="sm" onClick={() => saveMutation.mutate({ teams: { webhookUrl: teamsUrl || undefined, enabled: true, notifyOn: ['all'] } } as Record<string, unknown>)}>
            Save
          </Button>
        </div>
        <p className="text-[11px] text-text-tertiary">Sends run summary to Teams on completion</p>
      </div>

      {/* Jira */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <p className="text-sm font-medium mb-2 text-text-primary">Jira</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <Input size="sm" value={jiraBaseUrl} onChange={(e) => setJiraBaseUrl(e.target.value)} placeholder={(config?.jira?.baseUrl as string) ?? 'https://org.atlassian.net'} />
          <Input size="sm" value={jiraEmail} onChange={(e) => setJiraEmail(e.target.value)} placeholder="email@example.com" />
          <Input size="sm" type="password" value={jiraToken} onChange={(e) => setJiraToken(e.target.value)} placeholder="API Token" />
          <Input size="sm" value={jiraProject} onChange={(e) => setJiraProject(e.target.value)} placeholder="Project key (e.g. QA)" />
        </div>
        <Button size="sm" onClick={() => saveMutation.mutate({
          jira: { baseUrl: jiraBaseUrl || undefined, email: jiraEmail || undefined, apiToken: jiraToken || undefined, projectKey: jiraProject || undefined, enabled: true, autoCreateBugs: false },
        } as Record<string, unknown>)}>
          Save
        </Button>
        <p className="text-[11px] mt-1 text-text-tertiary">Auto-create bug tickets for test failures</p>
      </div>

      {/* GitHub */}
      <div className="px-4 py-3">
        <p className="text-sm font-medium mb-2 text-text-primary">GitHub</p>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <Input size="sm" type="password" value={ghToken} onChange={(e) => setGhToken(e.target.value)} placeholder="ghp_…" className="font-mono" />
          <Input size="sm" value={ghOwner} onChange={(e) => setGhOwner(e.target.value)} placeholder="Owner" />
          <Input size="sm" value={ghRepo} onChange={(e) => setGhRepo(e.target.value)} placeholder="Repo" />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => saveMutation.mutate({
            github: { token: ghToken || undefined, owner: ghOwner || undefined, repo: ghRepo || undefined, enabled: true, prComments: true, commitStatus: true },
          } as Record<string, unknown>)}>
            Save
          </Button>
          <Button variant="secondary" size="sm" icon={<Send size={11} />} onClick={() => testGitHub.mutate()}>
            Test Connection
          </Button>
        </div>
        <p className="text-[11px] mt-1 text-text-tertiary">Post PR comments and commit status checks</p>
      </div>
    </SettingsSection>
  );
}
