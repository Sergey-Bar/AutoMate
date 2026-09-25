import React from 'react';
import { Card, Input, Button, Badge, Stack, Label, Alert } from '@automate/ui';
import type { GitHubConfig, GitHubConnectionStatus } from '../../hooks/useGitHubIntegration.js';

export interface GitHubPRConfigProps {
  config: GitHubConfig;
  status: GitHubConnectionStatus;
  isSaving: boolean;
  isTesting: boolean;
  error: string | null;
  saveSuccess: boolean;
  onChange: (config: GitHubConfig) => void;
  onSave: (config: GitHubConfig) => void;
  onTestConnection: (config: GitHubConfig) => void;
}

export function GitHubPRConfig({
  config,
  status,
  isSaving,
  isTesting,
  error,
  saveSuccess,
  onChange,
  onSave,
  onTestConnection,
}: GitHubPRConfigProps) {
  const handleRepoUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...config, repoUrl: e.target.value });
  };

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...config, token: e.target.value });
  };

  const handleEventChange = (event: keyof GitHubConfig['events']) => (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...config, events: { ...config.events, [event]: e.target.checked } });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(config);
  };

  const handleTestConnection = () => {
    onTestConnection(config);
  };

  return (
    <div data-testid="github-pr-config" className="p-6 max-w-2xl mx-auto">
      <Stack gap={6}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">GitHub PR Check Integration</h2>
            <p className="text-sm text-fg-muted mt-1">
              Post test results as GitHub PR checks
            </p>
          </div>
          <Badge
            data-testid="connection-status"
            variant={status.connected ? 'success' : 'secondary'}
          >
            {status.connected ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>

        {error && (
          <Alert data-testid="config-error" variant="danger">
            {error}
          </Alert>
        )}

        {saveSuccess && (
          <Alert data-testid="save-success" variant="success">
            Configuration saved successfully!
          </Alert>
        )}

        <Card>
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="repo-url">Repository URL</Label>
              <Input
                id="repo-url"
                data-testid="repo-url-input"
                type="url"
                placeholder="https://github.com/owner/repo"
                value={config.repoUrl}
                onChange={handleRepoUrlChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="github-token">Personal Access Token</Label>
              <Input
                id="github-token"
                data-testid="token-input"
                type="password"
                placeholder="ghp_••••••••••••••••••••••••••••••••••••••"
                value={config.token}
                onChange={handleTokenChange}
              />
              <p className="text-xs text-fg-muted">
                Requires <code>repo:status</code> scope to post PR checks.
              </p>
            </div>

            <div className="space-y-3">
              <Label>Trigger Events</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer" data-testid="event-push-label">
                  <input
                    type="checkbox"
                    data-testid="event-push"
                    checked={config.events.push}
                    onChange={handleEventChange('push')}
                    className="rounded"
                  />
                  <span className="text-sm">Push</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" data-testid="event-pull-request-label">
                  <input
                    type="checkbox"
                    data-testid="event-pull-request"
                    checked={config.events.pull_request}
                    onChange={handleEventChange('pull_request')}
                    className="rounded"
                  />
                  <span className="text-sm">Pull Request</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" data-testid="event-schedule-label">
                  <input
                    type="checkbox"
                    data-testid="event-schedule"
                    checked={config.events.schedule}
                    onChange={handleEventChange('schedule')}
                    className="rounded"
                  />
                  <span className="text-sm">Schedule</span>
                </label>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                data-testid="save-button"
                disabled={isSaving}
              >
                {isSaving ? 'Saving…' : 'Save Configuration'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                data-testid="test-connection-button"
                disabled={isTesting || !config.repoUrl || !config.token}
                onClick={handleTestConnection}
              >
                {isTesting ? 'Testing…' : 'Test Connection'}
              </Button>
            </div>
          </form>
        </Card>

        {status.checkedAt && (
          <p className="text-xs text-fg-muted" data-testid="last-checked">
            Last checked: {new Date(status.checkedAt).toLocaleString()}
          </p>
        )}
      </Stack>
    </div>
  );
}
