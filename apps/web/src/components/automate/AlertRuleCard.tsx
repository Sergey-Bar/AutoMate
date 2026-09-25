import React from 'react';
import { Card, CardHeader, CardTitle, Badge, Button } from '@automate/ui';
import type { AlertRule } from '../../hooks/useAlertRules.js';

export interface AlertRuleCardProps {
  rule: AlertRule;
  onEdit?: (rule: AlertRule) => void;
  onDelete?: (id: string) => void;
  onToggle?: (id: string, enabled: boolean) => void;
}

const CONDITION_LABELS: Record<AlertRule['condition'], string> = {
  on_failure: 'On Failure',
  on_flaky: 'On Flaky',
  on_threshold: 'On Threshold',
};

const CHANNEL_LABELS: Record<AlertRule['channel'], string> = {
  slack: 'Slack',
  jira: 'Jira',
};

export function AlertRuleCard({ rule, onEdit, onDelete, onToggle }: AlertRuleCardProps) {
  const statusVariant = rule.enabled ? ('success' as const) : ('secondary' as const);

  return (
    <Card data-testid={`alert-rule-card-${rule.id}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base" data-testid={`alert-rule-name-${rule.id}`}>
            {rule.name}
          </CardTitle>
          <Badge variant={statusVariant} data-testid={`alert-rule-status-${rule.id}`}>
            {rule.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </CardHeader>
      <div className="p-4 pt-0">
        <div className="flex gap-2 mb-3 flex-wrap">
          <Badge variant="secondary" data-testid={`alert-rule-condition-${rule.id}`}>
            {CONDITION_LABELS[rule.condition]}
          </Badge>
          <Badge variant="secondary" data-testid={`alert-rule-channel-${rule.id}`}>
            {CHANNEL_LABELS[rule.channel]}
          </Badge>
        </div>
        <p className="text-sm text-fg-muted mb-4 truncate" data-testid={`alert-rule-target-${rule.id}`}>
          {rule.target}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid={`alert-rule-toggle-${rule.id}`}
            onClick={() => onToggle?.(rule.id, !rule.enabled)}
          >
            {rule.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid={`alert-rule-edit-${rule.id}`}
            onClick={() => onEdit?.(rule)}
          >
            Edit
          </Button>
          <Button
            variant="destructive"
            size="sm"
            data-testid={`alert-rule-delete-${rule.id}`}
            onClick={() => onDelete?.(rule.id)}
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
