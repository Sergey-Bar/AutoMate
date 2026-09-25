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
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
      }}
    >
      {icon && (
        <div style={{ marginBottom: '16px', color: '#6b7280' }}>{icon}</div>
      )}
      <h3 style={{ margin: '0 0 8px', fontSize: '1.125rem', fontWeight: 600 }}>{title}</h3>
      {description && (
        <p style={{ margin: '0 0 24px', fontSize: '0.875rem', color: '#6b7280', maxWidth: '360px' }}>
          {description}
        </p>
      )}
      {action && (
        <Button onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}
