/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderHook, act } from '@testing-library/react';
import { AlertRuleCard } from '../../../components/automate/AlertRuleCard.js';
import { AlertRuleForm } from '../../../components/automate/AlertRuleForm.js';
import { useAlertRules } from '../../../hooks/useAlertRules.js';
import type { AlertRule } from '../../../hooks/useAlertRules.js';

vi.mock('../../__root.js', () => ({
  Route: { id: '__root__' },
}));

const mockRule: AlertRule = {
  id: 'rule-1',
  name: 'CI Failure Alert',
  condition: 'on_failure',
  channel: 'slack',
  target: 'https://hooks.slack.com/test',
  enabled: true,
};

// ─── AlertRuleCard ────────────────────────────────────────────────────────────

describe('AlertRuleCard', () => {
  it('renders rule name, condition, channel, and target', () => {
    render(<AlertRuleCard rule={mockRule} />);
    expect(screen.getByTestId('alert-rule-card-rule-1')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-name-rule-1')).toHaveTextContent('CI Failure Alert');
    expect(screen.getByTestId('alert-rule-condition-rule-1')).toHaveTextContent('On Failure');
    expect(screen.getByTestId('alert-rule-channel-rule-1')).toHaveTextContent('Slack');
    expect(screen.getByTestId('alert-rule-target-rule-1')).toHaveTextContent('https://hooks.slack.com/test');
  });

  it('shows Enabled badge when rule is enabled', () => {
    render(<AlertRuleCard rule={mockRule} />);
    expect(screen.getByTestId('alert-rule-status-rule-1')).toHaveTextContent('Enabled');
  });

  it('shows Disabled badge when rule is disabled', () => {
    render(<AlertRuleCard rule={{ ...mockRule, enabled: false }} />);
    expect(screen.getByTestId('alert-rule-status-rule-1')).toHaveTextContent('Disabled');
  });

  it('calls onToggle with inverted enabled when toggle button clicked', () => {
    const onToggle = vi.fn();
    render(<AlertRuleCard rule={mockRule} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('alert-rule-toggle-rule-1'));
    expect(onToggle).toHaveBeenCalledWith('rule-1', false);
  });

  it('calls onEdit with rule when edit button clicked', () => {
    const onEdit = vi.fn();
    render(<AlertRuleCard rule={mockRule} onEdit={onEdit} />);
    fireEvent.click(screen.getByTestId('alert-rule-edit-rule-1'));
    expect(onEdit).toHaveBeenCalledWith(mockRule);
  });

  it('calls onDelete with rule id when delete button clicked', () => {
    const onDelete = vi.fn();
    render(<AlertRuleCard rule={mockRule} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('alert-rule-delete-rule-1'));
    expect(onDelete).toHaveBeenCalledWith('rule-1');
  });
});

// ─── AlertRuleForm ────────────────────────────────────────────────────────────

describe('AlertRuleForm', () => {
  it('renders all form fields', () => {
    render(<AlertRuleForm onSubmit={vi.fn()} />);
    expect(screen.getByTestId('alert-rule-form')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-condition-select')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-channel-select')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-target-input')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-enabled-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-submit')).toBeInTheDocument();
  });

  it('pre-fills fields from initial prop', () => {
    render(<AlertRuleForm initial={mockRule} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('alert-rule-name-input')).toHaveValue('CI Failure Alert');
    expect(screen.getByTestId('alert-rule-condition-select')).toHaveValue('on_failure');
    expect(screen.getByTestId('alert-rule-channel-select')).toHaveValue('slack');
    expect(screen.getByTestId('alert-rule-target-input')).toHaveValue('https://hooks.slack.com/test');
    expect(screen.getByTestId('alert-rule-enabled-toggle')).toBeChecked();
  });

  it('calls onSubmit with form values when submitted', () => {
    const onSubmit = vi.fn();
    render(<AlertRuleForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('alert-rule-name-input'), { target: { value: 'New Rule' } });
    fireEvent.change(screen.getByTestId('alert-rule-condition-select'), { target: { value: 'on_flaky' } });
    fireEvent.change(screen.getByTestId('alert-rule-channel-select'), { target: { value: 'jira' } });
    fireEvent.change(screen.getByTestId('alert-rule-target-input'), { target: { value: 'PROJ' } });
    fireEvent.submit(screen.getByTestId('alert-rule-form'));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'New Rule',
      condition: 'on_flaky',
      channel: 'jira',
      target: 'PROJ',
      enabled: true,
    });
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<AlertRuleForm onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('alert-rule-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables submit button when isSubmitting is true', () => {
    render(<AlertRuleForm onSubmit={vi.fn()} isSubmitting />);
    expect(screen.getByTestId('alert-rule-submit')).toBeDisabled();
  });

  it('toggles enabled state when checkbox clicked', () => {
    render(<AlertRuleForm onSubmit={vi.fn()} />);
    const toggle = screen.getByTestId('alert-rule-enabled-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
  });
});

// ─── useAlertRules ────────────────────────────────────────────────────────────

describe('useAlertRules', () => {
  it('loads rules on mount', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [mockRule],
    });

    const { result } = renderHook(() => useAlertRules({ fetchFn }));
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rules).toEqual([mockRule]);
  });

  it('creates a rule and appends it to the list', async () => {
    const newRule = { ...mockRule, id: 'rule-2', name: 'New Rule' };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => newRule });

    const { result } = renderHook(() => useAlertRules({ fetchFn }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createRule({ name: 'New Rule', condition: 'on_failure', channel: 'slack', target: 'url', enabled: true });
    });

    expect(result.current.rules).toHaveLength(1);
    expect(result.current.rules[0].name).toBe('New Rule');
  });

  it('toggles a rule enabled state', async () => {
    const updatedRule = { ...mockRule, enabled: false };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [mockRule] })
      .mockResolvedValueOnce({ ok: true, json: async () => updatedRule });

    const { result } = renderHook(() => useAlertRules({ fetchFn }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.toggleRule('rule-1', false);
    });

    expect(result.current.rules[0].enabled).toBe(false);
  });

  it('deletes a rule from the list', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [mockRule] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const { result } = renderHook(() => useAlertRules({ fetchFn }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteRule('rule-1');
    });

    expect(result.current.rules).toHaveLength(0);
  });

  it('sets error when fetch fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(() => useAlertRules({ fetchFn }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Failed to load alert rules');
  });
});

// ─── AlertRulesPage ───────────────────────────────────────────────────────────

import { AlertRulesPage, Route as AlertsRoute } from './alerts.js';

describe('AlertRulesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state while rules are being fetched', () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}));
    render(<AlertRulesPage />);
    expect(screen.getByTestId('alert-rules-loading')).toBeInTheDocument();
  });

  it('renders empty state when no rules exist', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [] } as Response)
    );
    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-rules-empty')).toBeInTheDocument();
    });
  });

  it('renders rules list when rules are loaded', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [mockRule] } as Response)
    );
    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-rules-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('alert-rule-card-rule-1')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-name-rule-1')).toHaveTextContent('CI Failure Alert');
  });

  it('renders error banner when fetch fails', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500 } as Response)
    );
    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-rules-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('alert-rules-error')).toHaveTextContent('Failed to load alert rules');
  });

  it('shows Add Rule button and page heading when loaded', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [] } as Response)
    );
    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('add-alert-rule-btn')).toBeInTheDocument();
    });
    expect(screen.getByText('Alert Rules')).toBeInTheDocument();
  });

  it('shows create form and hides Add Rule button when Add Rule is clicked', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [] } as Response)
    );
    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('add-alert-rule-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('add-alert-rule-btn'));
    expect(screen.getByTestId('alert-rule-form-container')).toBeInTheDocument();
    expect(screen.getByText('New Alert Rule')).toBeInTheDocument();
    expect(screen.queryByTestId('add-alert-rule-btn')).not.toBeInTheDocument();
  });

  it('hides form and shows Add Rule button when cancel is clicked', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [] } as Response)
    );
    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('add-alert-rule-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('add-alert-rule-btn'));
    expect(screen.getByTestId('alert-rule-form-container')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('alert-rule-cancel'));
    expect(screen.queryByTestId('alert-rule-form-container')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-alert-rule-btn')).toBeInTheDocument();
  });

  it('creates a rule and closes form on successful submit', async () => {
    const createdRule: AlertRule = { ...mockRule, id: 'rule-new', name: 'New Rule' };
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => createdRule } as Response);

    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('add-alert-rule-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('add-alert-rule-btn'));

    // fill out the form with valid values
    fireEvent.change(screen.getByTestId('alert-rule-name-input'), { target: { value: 'New Rule' } });
    fireEvent.change(screen.getByTestId('alert-rule-target-input'), { target: { value: 'https://hooks.slack.com/test' } });
    fireEvent.submit(screen.getByTestId('alert-rule-form'));

    await waitFor(() => {
      expect(screen.queryByTestId('alert-rule-form-container')).not.toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('shows edit form with pre-filled data when edit button is clicked', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [mockRule] } as Response)
    );
    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-rule-card-rule-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('alert-rule-edit-rule-1'));
    expect(screen.getByTestId('alert-rule-form-container')).toBeInTheDocument();
    expect(screen.getByText('Edit Rule')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-name-input')).toHaveValue('CI Failure Alert');
  });

  it('closes edit form when cancel is clicked', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [mockRule] } as Response)
    );
    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-rule-card-rule-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('alert-rule-edit-rule-1'));
    expect(screen.getByTestId('alert-rule-form-container')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('alert-rule-cancel'));
    expect(screen.queryByTestId('alert-rule-form-container')).not.toBeInTheDocument();
  });

  it('updates a rule on edit form submit', async () => {
    const updatedRule: AlertRule = { ...mockRule, name: 'Updated Rule' };
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [mockRule] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => updatedRule } as Response);

    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-rule-edit-rule-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('alert-rule-edit-rule-1'));
    fireEvent.change(screen.getByTestId('alert-rule-name-input'), { target: { value: 'Updated Rule' } });
    fireEvent.submit(screen.getByTestId('alert-rule-form'));

    await waitFor(() => {
      expect(screen.queryByTestId('alert-rule-form-container')).not.toBeInTheDocument();
    });
  });

  it('deletes a rule when delete button is clicked', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [mockRule] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);

    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-rule-card-rule-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('alert-rule-delete-rule-1'));
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('toggles a rule when toggle button is clicked', async () => {
    const toggledRule: AlertRule = { ...mockRule, enabled: false };
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [mockRule] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => toggledRule } as Response);

    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-rule-toggle-rule-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('alert-rule-toggle-rule-1'));
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('renders page-level container testid', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [] } as Response)
    );
    render(<AlertRulesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-rules-page')).toBeInTheDocument();
    });
  });

  it('Route.options.getParentRoute returns defined parent', () => {
    const opts = (AlertsRoute as unknown as { options: { getParentRoute: () => unknown } }).options;
    expect(opts.getParentRoute()).toBeDefined();
  });

  it('Route.options.component renders AlertRulesPage', async () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const opts = (AlertsRoute as unknown as { options: { component: React.ComponentType } }).options;
    render(React.createElement(opts.component));
    expect(screen.getByTestId('alert-rules-loading')).toBeInTheDocument();
  });
});
