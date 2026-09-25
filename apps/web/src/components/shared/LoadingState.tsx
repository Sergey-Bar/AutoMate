import React from 'react';
import { Skeleton } from '@automate/ui';

export interface LoadingStateProps {
  'data-testid'?: string;
}

export function LoadingState({ 'data-testid': testId = 'loading-state' }: LoadingStateProps = {}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '16px',
        padding: '48px 24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          width: '100%',
          maxWidth: '480px',
        }}
      >
        <Skeleton
          data-testid="skeleton-1"
          variant="text"
          style={{ width: '60%', height: '24px' }}
        />
        <Skeleton
          data-testid="skeleton-2"
          variant="text"
          style={{ width: '100%', height: '16px' }}
        />
        <Skeleton
          data-testid="skeleton-3"
          variant="text"
          style={{ width: '80%', height: '16px' }}
        />
        <Skeleton
          data-testid="skeleton-4"
          variant="block"
          style={{ width: '100%', height: '120px' }}
        />
      </div>
    </div>
  );
}
