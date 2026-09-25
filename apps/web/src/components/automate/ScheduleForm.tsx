import React, { useState, useEffect } from 'react';
import { Button, Input, Label, Toggle } from '@automate/ui';
import type { CreateScheduleInput, Schedule } from '../../hooks/useSchedules.js';
import { parseCron, isValidCron } from '../../services/cron-parser.js';

export interface Suite {
  id: string;
  name: string;
}

export interface ScheduleFormProps {
  initial?: Partial<Schedule>;
  suites: Suite[];
  onSubmit: (input: CreateScheduleInput) => void | Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function ScheduleForm({ initial, suites, onSubmit, onCancel, isSubmitting }: ScheduleFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [cron, setCron] = useState(initial?.cron ?? '');
  const [suiteId, setSuiteId] = useState(initial?.suiteId ?? (suites[0]?.id ?? ''));
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (suites.length > 0 && !suiteId) {
      setSuiteId(suites[0]!.id);
    }
  }, [suites, suiteId]);

  const humanCron = cron && isValidCron(cron) ? parseCron(cron) : null;
  const cronError = cron && !isValidCron(cron) ? 'Invalid cron expression' : null;

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors['name'] = 'Name is required';
    if (!cron.trim()) newErrors['cron'] = 'Cron expression is required';
    else if (!isValidCron(cron)) newErrors['cron'] = 'Invalid cron expression';
    if (!suiteId) newErrors['suiteId'] = 'Suite is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit({ name: name.trim(), cron: cron.trim(), suiteId, enabled });
  }

  return (
    <form data-testid="schedule-form" onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="schedule-name">Name</Label>
        <Input
          id="schedule-name"
          data-testid="schedule-form-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Nightly regression"
        />
        {errors['name'] && (
          <p className="text-sm text-danger" data-testid="schedule-form-name-error">
            {errors['name']}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="schedule-cron">Cron Expression</Label>
        <Input
          id="schedule-cron"
          data-testid="schedule-form-cron"
          value={cron}
          onChange={e => setCron(e.target.value)}
          placeholder="e.g. 0 9 * * 1-5"
          className={cronError ? 'border-danger' : ''}
        />
        {humanCron && (
          <p className="text-sm text-fg-muted" data-testid="schedule-form-cron-preview">
            {humanCron}
          </p>
        )}
        {cronError && (
          <p className="text-sm text-danger" data-testid="schedule-form-cron-error">
            {cronError}
          </p>
        )}
        {errors['cron'] && !cronError && (
          <p className="text-sm text-danger" data-testid="schedule-form-cron-required">
            {errors['cron']}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="schedule-suite">Test Suite</Label>
        <select
          id="schedule-suite"
          data-testid="schedule-form-suite"
          value={suiteId}
          onChange={e => setSuiteId(e.target.value)}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-border-focus"
        >
          {suites.map(suite => (
            <option key={suite.id} value={suite.id}>
              {suite.name}
            </option>
          ))}
        </select>
        {errors['suiteId'] && (
          <p className="text-sm text-danger" data-testid="schedule-form-suite-error">
            {errors['suiteId']}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Toggle
          id="schedule-enabled"
          data-testid="schedule-form-enabled"
          checked={enabled}
          onChange={e => setEnabled(e.target.checked)}
          label="Enabled"
        />
        <Label htmlFor="schedule-enabled">Enabled</Label>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button
          type="submit"
          data-testid="schedule-form-submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving…' : initial?.id ? 'Update Schedule' : 'Create Schedule'}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            data-testid="schedule-form-cancel"
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
