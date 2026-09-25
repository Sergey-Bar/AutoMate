import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as rootRoute } from '../../__root.js';
import { GitHubPRConfig } from '../../../components/automate/GitHubPRConfig.js';
import { useGitHubIntegration } from '../../../hooks/useGitHubIntegration.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/integrations/github',
  component: GitHubIntegrationPage,
});

export function GitHubIntegrationPage() {
  const {
    config,
    setConfig,
    status,
    isLoading,
    isSaving,
    isTesting,
    error,
    saveSuccess,
    saveConfig,
    testConnection,
  } = useGitHubIntegration();

  if (isLoading) {
    return (
      <div data-testid="github-integration-loading" className="p-6">
        <p className="text-fg-muted">Loading configuration…</p>
      </div>
    );
  }

  return (
    <div data-testid="github-integration-page">
      <GitHubPRConfig
        config={config}
        status={status}
        isSaving={isSaving}
        isTesting={isTesting}
        error={error}
        saveSuccess={saveSuccess}
        onChange={setConfig}
        onSave={saveConfig}
        onTestConnection={testConnection}
      />
    </div>
  );
}
