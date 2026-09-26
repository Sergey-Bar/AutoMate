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
      className="flex flex-col items-center justify-center px-6 py-12 text-center"
    >
      <div data-testid="error-icon" className="mb-4 text-4xl text-error" aria-hidden="true">
        ⚠️
      </div>
      <h3 className="mb-2 text-lg font-semibold text-text-primary">{title}</h3>
      <p className="mb-6 max-w-sm text-sm text-text-muted">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} data-testid="retry-button">
          Try again
        </Button>
      )}
    </div>
  );
}
