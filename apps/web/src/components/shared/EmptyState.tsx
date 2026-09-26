import React, { type ReactNode } from 'react';
import { Button } from '@automate/ui';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  'data-testid'?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  'data-testid': testId = 'empty-state',
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center justify-center px-6 py-12 text-center"
    >
      {icon && <div className="mb-4 text-text-muted">{icon}</div>}
      <h3 className="mb-2 text-lg font-semibold text-text-primary">{title}</h3>
      {description && <p className="mb-6 max-w-sm text-sm text-text-muted">{description}</p>}
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
