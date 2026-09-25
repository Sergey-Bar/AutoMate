import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the feature store
let mockLoaded = true;
vi.mock('@/store/featureStore', () => ({
  useFeature: vi.fn((flag: string) => flag === 'enabled-feature'),
  useFeatureStore: vi.fn((selector: (s: { loaded: boolean }) => boolean) => selector({ loaded: mockLoaded })),
}));

describe('FeatureGate', () => {
  it('renders children when flag is enabled', async () => {
    const { FeatureGate } = await import('./FeatureGate.js');
    render(
      <FeatureGate flag="enabled-feature">
        <div data-testid="child">Visible</div>
      </FeatureGate>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders nothing when flag is disabled', async () => {
    const { FeatureGate } = await import('./FeatureGate.js');
    render(
      <FeatureGate flag="disabled-feature">
        <div data-testid="child">Hidden</div>
      </FeatureGate>
    );
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('renders fallback when flag is disabled and fallback provided', async () => {
    const { FeatureGate } = await import('./FeatureGate.js');
    render(
      <FeatureGate flag="disabled-feature" fallback={<div data-testid="fallback">Alt</div>}>
        <div data-testid="child">Hidden</div>
      </FeatureGate>
    );
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('renders children when flags are not yet loaded (permissive)', async () => {
    mockLoaded = false;
    const { FeatureGate } = await import('./FeatureGate.js');
    render(
      <FeatureGate flag="disabled-feature" fallback={<div data-testid="fallback">Alt</div>}>
        <div data-testid="child">Visible</div>
      </FeatureGate>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
    mockLoaded = true; // restore for other tests
  });
});
