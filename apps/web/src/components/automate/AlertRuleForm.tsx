import React, { useState } from 'react';
import { Button, Input } from '@automate/ui';
import type { AlertRule, AlertCondition, AlertChannel } from '../../hooks/useAlertRules.js';

export interface AlertRuleFormProps {
  initial?: Partial<AlertRule>;
  onSubmit: (rule: Omit<AlertRule, 'id'>) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

const CONDITIONS: { value: AlertCondition; label: string }[] = [
  { value: 'on_failure', label: 'On Failure' },
  { value: 'on_flaky', label: 'On Flaky' },
  { value: 'on_threshold', label: 'On Threshold' },
];

const CHANNELS: { value: AlertChannel; label: string }[] = [
  { value: 'slack', label: 'Slack' },
  { value: 'jira', label: 'Jira' },
];

export function AlertRuleForm({ initial, onSubmit, onCancel, isSubmitting }: AlertRuleFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [condition, setCondition] = useState<AlertCondition>(initial?.condition ?? 'on_failure');
  const [channel, setChannel] = useState<AlertChannel>(initial?.channel ?? 'slack');
  const [target, setTarget] = useState(initial?.target ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ name, condition, channel, target, enabled });
  }

  return (
    <form data-testid="alert-rule-form" onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="alert-rule-name" className="block text-sm font-medium mb-1">
          Rule Name
        </label>
        <Input
          id="alert-rule-name"
          data-testid="alert-rule-name-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Notify on CI failure"
          required
        />
      </div>

      <div>
        <label htmlFor="alert-rule-condition" className="block text-sm font-medium mb-1">
          Condition
        </label>
        <select
          id="alert-rule-condition"
          data-testid="alert-rule-condition-select"
          value={condition}
          onChange={e => setCondition(e.target.value as AlertCondition)}
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface"
        >
          {CONDITIONS.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="alert-rule-channel" className="block text-sm font-medium mb-1">
          Channel
        </label>
        <select
          id="alert-rule-channel"
          data-testid="alert-rule-channel-select"
          value={channel}
          onChange={e => setChannel(e.target.value as AlertChannel)}
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface"
        >
          {CHANNELS.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="alert-rule-target" className="block text-sm font-medium mb-1">
          Target (Webhook URL or Project Key)
        </label>
        <Input
          id="alert-rule-target"
          data-testid="alert-rule-target-input"
          value={target}
          onChange={e => setTarget(e.target.value)}
          placeholder="https://hooks.slack.com/... or PROJ"
          required
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="alert-rule-enabled"
          data-testid="alert-rule-enabled-toggle"
          type="checkbox"
          checked={enabled}
          onChange={e => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor="alert-rule-enabled" className="text-sm font-medium">
          Enabled
        </label>
      </div>

      <div className="flex gap-2">
        <Button
          type="submit"
          data-testid="alert-rule-submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving…' : 'Save Rule'}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            data-testid="alert-rule-cancel"
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
