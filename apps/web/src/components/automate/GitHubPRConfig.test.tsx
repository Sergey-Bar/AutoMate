/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { GitHubPRConfig } from './GitHubPRConfig.js';
import type { GitHubPRConfigProps } from './GitHubPRConfig.js';
import type { GitHubConfig, GitHubConnectionStatus } from '../../hooks/useGitHubIntegration.js';

const baseConfig: GitHubConfig = {
  repoUrl: 'https://github.com/owner/repo',
  token: 'ghp_abc123',
  events: { push: true, pull_request: true, schedule: false },
};

const disconnectedStatus: GitHubConnectionStatus = { connected: false, checkedAt: null };
const connectedStatus: GitHubConnectionStatus = { connected: true, checkedAt: '2024-01-15T10:00:00.000Z' };

function makeProps(overrides: Partial<GitHubPRConfigProps> = {}): GitHubPRConfigProps {
  return {
    config: baseConfig,
    status: disconnectedStatus,
    isSaving: false,
    isTesting: false,
    error: null,
    saveSuccess: false,
    onChange: vi.fn(),
    onSave: vi.fn(),
    onTestConnection: vi.fn(),
    ...overrides,
  };
}

describe('GitHubPRConfig', () => {
  describe('rendering', () => {
    it('renders the root container', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.getByTestId('github-pr-config')).toBeInTheDocument();
    });

    it('shows "Disconnected" badge when status.connected is false', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Disconnected');
    });

    it('shows "Connected" badge when status.connected is true', () => {
      render(<GitHubPRConfig {...makeProps({ status: connectedStatus })} />);
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected');
    });

    it('renders the repo URL input with current value', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.getByTestId('repo-url-input')).toHaveValue('https://github.com/owner/repo');
    });

    it('renders the token input with current value', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.getByTestId('token-input')).toHaveValue('ghp_abc123');
    });

    it('renders push event checkbox checked when config.events.push is true', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.getByTestId('event-push')).toBeChecked();
    });

    it('renders pull_request event checkbox checked when config.events.pull_request is true', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.getByTestId('event-pull-request')).toBeChecked();
    });

    it('renders schedule event checkbox unchecked when config.events.schedule is false', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.getByTestId('event-schedule')).not.toBeChecked();
    });

    it('renders "Save Configuration" on save button when not saving', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.getByTestId('save-button')).toHaveTextContent('Save Configuration');
    });

    it('renders "Saving…" on save button when isSaving=true', () => {
      render(<GitHubPRConfig {...makeProps({ isSaving: true })} />);
      expect(screen.getByTestId('save-button')).toHaveTextContent('Saving…');
    });

    it('disables save button when isSaving=true', () => {
      render(<GitHubPRConfig {...makeProps({ isSaving: true })} />);
      expect(screen.getByTestId('save-button')).toBeDisabled();
    });

    it('renders "Test Connection" button', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.getByTestId('test-connection-button')).toHaveTextContent('Test Connection');
    });

    it('renders "Testing…" on test button when isTesting=true', () => {
      render(<GitHubPRConfig {...makeProps({ isTesting: true })} />);
      expect(screen.getByTestId('test-connection-button')).toHaveTextContent('Testing…');
    });

    it('disables test connection button when isTesting=true', () => {
      render(<GitHubPRConfig {...makeProps({ isTesting: true })} />);
      expect(screen.getByTestId('test-connection-button')).toBeDisabled();
    });

    it('disables test connection button when repoUrl is empty', () => {
      const config: GitHubConfig = { ...baseConfig, repoUrl: '' };
      render(<GitHubPRConfig {...makeProps({ config })} />);
      expect(screen.getByTestId('test-connection-button')).toBeDisabled();
    });

    it('disables test connection button when token is empty', () => {
      const config: GitHubConfig = { ...baseConfig, token: '' };
      render(<GitHubPRConfig {...makeProps({ config })} />);
      expect(screen.getByTestId('test-connection-button')).toBeDisabled();
    });

    it('enables test connection button when both repoUrl and token are set', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.getByTestId('test-connection-button')).not.toBeDisabled();
    });

    it('does not render error alert when error is null', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.queryByTestId('config-error')).toBeNull();
    });

    it('renders error alert when error is provided', () => {
      render(<GitHubPRConfig {...makeProps({ error: 'Token is invalid' })} />);
      expect(screen.getByTestId('config-error')).toHaveTextContent('Token is invalid');
    });

    it('does not render save-success alert when saveSuccess is false', () => {
      render(<GitHubPRConfig {...makeProps()} />);
      expect(screen.queryByTestId('save-success')).toBeNull();
    });

    it('renders save-success alert when saveSuccess is true', () => {
      render(<GitHubPRConfig {...makeProps({ saveSuccess: true })} />);
      expect(screen.getByTestId('save-success')).toHaveTextContent('Configuration saved successfully!');
    });

    it('does not render last-checked text when checkedAt is null', () => {
      render(<GitHubPRConfig {...makeProps({ status: disconnectedStatus })} />);
      expect(screen.queryByTestId('last-checked')).toBeNull();
    });

    it('renders last-checked text when checkedAt is set', () => {
      render(<GitHubPRConfig {...makeProps({ status: connectedStatus })} />);
      expect(screen.getByTestId('last-checked')).toBeInTheDocument();
      expect(screen.getByTestId('last-checked').textContent).toMatch(/Last checked:/);
    });
  });

  describe('callbacks', () => {
    it('calls onChange with updated repoUrl when repo URL input changes', () => {
      const onChange = vi.fn();
      render(<GitHubPRConfig {...makeProps({ onChange })} />);
      fireEvent.change(screen.getByTestId('repo-url-input'), {
        target: { value: 'https://github.com/new/repo' },
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        ...baseConfig,
        repoUrl: 'https://github.com/new/repo',
      });
    });

    it('calls onChange with updated token when token input changes', () => {
      const onChange = vi.fn();
      render(<GitHubPRConfig {...makeProps({ onChange })} />);
      fireEvent.change(screen.getByTestId('token-input'), {
        target: { value: 'ghp_newtoken' },
      });
      expect(onChange).toHaveBeenCalledWith({
        ...baseConfig,
        token: 'ghp_newtoken',
      });
    });

    it('calls onChange with toggled push event when push checkbox changes', () => {
      const onChange = vi.fn();
      render(<GitHubPRConfig {...makeProps({ onChange })} />);
      act(() => {
        (screen.getByTestId('event-push') as HTMLInputElement).click();
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        ...baseConfig,
        events: { ...baseConfig.events, push: false },
      });
    });

    it('calls onChange with toggled pull_request event when checkbox changes', () => {
      const onChange = vi.fn();
      render(<GitHubPRConfig {...makeProps({ onChange })} />);
      act(() => {
        (screen.getByTestId('event-pull-request') as HTMLInputElement).click();
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        ...baseConfig,
        events: { ...baseConfig.events, pull_request: false },
      });
    });

    it('calls onChange with toggled schedule event when checkbox changes', () => {
      const onChange = vi.fn();
      render(<GitHubPRConfig {...makeProps({ onChange })} />);
      act(() => {
        (screen.getByTestId('event-schedule') as HTMLInputElement).click();
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        ...baseConfig,
        events: { ...baseConfig.events, schedule: true },
      });
    });

    it('calls onSave with current config when form is submitted', () => {
      const onSave = vi.fn();
      render(<GitHubPRConfig {...makeProps({ onSave })} />);
      fireEvent.submit(screen.getByTestId('github-pr-config').querySelector('form')!);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(baseConfig);
    });

    it('calls onSave when Save Configuration button is clicked', () => {
      const onSave = vi.fn();
      render(<GitHubPRConfig {...makeProps({ onSave })} />);
      fireEvent.click(screen.getByTestId('save-button'));
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(baseConfig);
    });

    it('calls onTestConnection with current config when Test Connection is clicked', () => {
      const onTestConnection = vi.fn();
      render(<GitHubPRConfig {...makeProps({ onTestConnection })} />);
      fireEvent.click(screen.getByTestId('test-connection-button'));
      expect(onTestConnection).toHaveBeenCalledTimes(1);
      expect(onTestConnection).toHaveBeenCalledWith(baseConfig);
    });
  });
});
