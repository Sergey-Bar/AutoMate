import React from 'react';
import { Button } from '@automate/ui';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  'data-testid'?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  'data-testid': testId = 'error-state',
}: ErrorStateProps) {
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
      <div
        data-testid="error-icon"
        style={{ marginBottom: '16px', fontSize: '2.5rem', color: '#ef4444' }}
        aria-hidden="true"
      >
        ⚠️
      </div>
      <h3 style={{ margin: '0 0 8px', fontSize: '1.125rem', fontWeight: 600 }}>{title}</h3>
      <p style={{ margin: '0 0 24px', fontSize: '0.875rem', color: '#6b7280', maxWidth: '360px' }}>
        {message}
      </p>
      {onRetry && (
        <Button onClick={onRetry} data-testid="retry-button">
          Try again
        </Button>
      )}
    </div>
  );
}
