import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictMap } from './conflict-map.js';
import * as useAgentConflicts from '@/hooks/useAgentConflicts';

vi.mock('@/hooks/useAgentConflicts', () => ({
  useAgentConflicts: vi.fn(),
}));

vi.mock('@/components/FeatureGate', () => ({
  FeatureGate: ({ children }: any) => <div data-testid="feature-gate">{children}</div>,
}));

describe('ConflictMap', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders loading state', () => {
    vi.spyOn(useAgentConflicts, 'useAgentConflicts').mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(<ConflictMap />);
    expect(screen.getByText('Loading conflicts...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.spyOn(useAgentConflicts, 'useAgentConflicts').mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to fetch'),
    } as any);

    render(<ConflictMap />);
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
  });

  it('renders empty state when no conflicts', () => {
    vi.spyOn(useAgentConflicts, 'useAgentConflicts').mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as any);

    render(<ConflictMap />);
    expect(screen.getByText('No File Overlaps')).toBeInTheDocument();
  });

  it('renders conflicts', () => {
    vi.spyOn(useAgentConflicts, 'useAgentConflicts').mockReturnValue({
      data: [
        {
          id: 'c1',
          repository: 'acme/app',
          sessionIds: ['s1-uuid', 's2-uuid'],
          overlappingFiles: ['src/index.ts', 'package.json'],
          severity: 'warning',
          status: 'active',
          firstDetectedAt: new Date().toISOString(),
          lastDetectedAt: new Date().toISOString(),
        }
      ],
      isLoading: false,
      error: null,
    } as any);

    render(<ConflictMap />);
    expect(screen.getByText('acme/app')).toBeInTheDocument();
    expect(screen.getByText('s1-uuid...')).toBeInTheDocument();
    expect(screen.getByText('s2-uuid...')).toBeInTheDocument();
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
  });
});
