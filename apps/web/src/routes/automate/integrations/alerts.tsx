import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as rootRoute } from '../../__root.js';
import { Button } from '@automate/ui';
import { AlertRuleCard } from '../../../components/automate/AlertRuleCard.js';
import { AlertRuleForm } from '../../../components/automate/AlertRuleForm.js';
import { useAlertRules } from '../../../hooks/useAlertRules.js';
import type { AlertRule } from '../../../hooks/useAlertRules.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/integrations/alerts',
  component: AlertRulesPage,
});

export function AlertRulesPage() {
  const { rules, isLoading, error, createRule, updateRule, deleteRule, toggleRule } = useAlertRules();
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCreate(rule: Omit<AlertRule, 'id'>) {
    setIsSubmitting(true);
    await createRule(rule);
    setIsSubmitting(false);
    setShowForm(false);
  }

  async function handleUpdate(rule: Omit<AlertRule, 'id'>) {
    if (!editingRule) return;
    setIsSubmitting(true);
    await updateRule(editingRule.id, rule);
    setIsSubmitting(false);
    setEditingRule(null);
  }

  if (isLoading) {
    return (
      <div data-testid="alert-rules-loading" className="p-6">
        <p className="text-fg-muted">Loading alert rules…</p>
      </div>
    );
  }

  return (
    <div data-testid="alert-rules-page" className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Alert Rules</h1>
          <p className="text-fg-muted text-sm mt-1">
            Configure notifications to Slack or Jira on test failures.
          </p>
        </div>
        {!showForm && !editingRule && (
          <Button
            data-testid="add-alert-rule-btn"
            onClick={() => setShowForm(true)}
          >
            Add Rule
          </Button>
        )}
      </div>

      {error && (
        <p className="text-destructive text-sm" data-testid="alert-rules-error">{error}</p>
      )}

      {(showForm || editingRule) && (
        <div className="border border-border rounded-lg p-4" data-testid="alert-rule-form-container">
          <h2 className="text-lg font-medium mb-4">
            {editingRule ? 'Edit Rule' : 'New Alert Rule'}
          </h2>
          <AlertRuleForm
            initial={editingRule ?? undefined}
            onSubmit={editingRule ? handleUpdate : handleCreate}
            onCancel={() => { setShowForm(false); setEditingRule(null); }}
            isSubmitting={isSubmitting}
          />
        </div>
      )}

      {rules.length === 0 && !showForm ? (
        <p className="text-fg-muted text-sm" data-testid="alert-rules-empty">
          No alert rules configured yet.
        </p>
      ) : (
        <div className="grid gap-4" data-testid="alert-rules-list">
          {rules.map(rule => (
            <AlertRuleCard
              key={rule.id}
              rule={rule}
              onEdit={r => { setEditingRule(r); setShowForm(false); }}
              onDelete={deleteRule}
              onToggle={toggleRule}
            />
          ))}
        </div>
      )}
    </div>
  );
}
