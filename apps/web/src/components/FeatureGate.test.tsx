import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// Mock the featureStore so we can control what useFeature and useFeatureStore return
const mockFlags: Record<string, boolean> = {};
let mockLoaded = false;

vi.mock('@/store/featureStore.js', () => ({
  useFeatureStore: vi.fn((selector: (s: { flags: Record<string, boolean>; loaded: boolean }) => unknown) => {
    return selector({ flags: mockFlags, loaded: mockLoaded });
  }),
  useFeature: vi.fn((flag: string) => mockFlags[flag] ?? false),
}));

import { FeatureGate } from './FeatureGate.js';

beforeEach(() => {
  // Reset to unloaded state with no flags
  Object.keys(mockFlags).forEach((k) => {
    delete mockFlags[k];
  });
  mockLoaded = false;
});

describe('FeatureGate', () => {
  it('renders children when flag is enabled and loaded', () => {
    mockFlags['my-feature'] = true;
    mockLoaded = true;
    const html = renderToString(
      <FeatureGate flag="my-feature">
        <div data-testid="gated-content">Feature Content</div>
      </FeatureGate>,
    );
    expect(html).toContain('Feature Content');
    expect(html).toContain('data-testid="gated-content"');
  });

  it('renders fallback when flag is disabled and loaded', () => {
    mockFlags['my-feature'] = false;
    mockLoaded = true;
    const html = renderToString(
      <FeatureGate flag="my-feature" fallback={<div data-testid="fallback">Fallback</div>}>
        <div data-testid="gated-content">Feature Content</div>
      </FeatureGate>,
    );
    expect(html).toContain('Fallback');
    expect(html).not.toContain('Feature Content');
  });

  it('renders null fallback by default when flag is disabled', () => {
    mockFlags['my-feature'] = false;
    mockLoaded = true;
    const html = renderToString(
      <FeatureGate flag="my-feature">
        <div>Hidden</div>
      </FeatureGate>,
    );
    expect(html).not.toContain('Hidden');
    // Empty render
    expect(html.trim()).toBe('');
  });

  it('renders children when not yet loaded (permissive)', () => {
    mockLoaded = false;
    const html = renderToString(
      <FeatureGate flag="new-feature" fallback={<span>Loading...</span>}>
        <div data-testid="optimistic">Loading Content</div>
      </FeatureGate>,
    );
    // When !loaded, children are shown (permissive — avoids flash of missing content)
    expect(html).toContain('Loading Content');
    expect(html).not.toContain('Loading...');
  });

  it('renders fallback when flag is not in flags map but loaded (defaults to false)', () => {
    mockLoaded = true;
    // mockFlags has no 'unknown-feature' entry
    const html = renderToString(
      <FeatureGate flag="unknown-feature" fallback={<span>Fallback</span>}>
        <div>Content</div>
      </FeatureGate>,
    );
    // unknown flag defaults to false => fallback shown
    expect(html).toContain('Fallback');
    expect(html).not.toContain('Content');
  });

  it('renders multiple children through the gate', () => {
    mockFlags['feature-x'] = true;
    mockLoaded = true;
    const html = renderToString(
      <FeatureGate flag="feature-x">
        <p>Item 1</p>
        <p>Item 2</p>
      </FeatureGate>,
    );
    expect(html).toContain('Item 1');
    expect(html).toContain('Item 2');
  });

  it('uses useFeature hook to check flag', () => {
    mockFlags['sql-browser'] = true;
    mockLoaded = true;
    const html = renderToString(
      <FeatureGate flag="sql-browser">
        <span>SQL Browser Enabled</span>
      </FeatureGate>,
    );
    expect(html).toContain('SQL Browser Enabled');
  });
});
