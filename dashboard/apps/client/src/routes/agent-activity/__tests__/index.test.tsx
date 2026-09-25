/**
 * agent-activity.test.tsx
 *
 * Tests for the /agent-activity route.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/test-utils';

// Hoist mock setup
const mocks = vi.hoisted(() => ({
  routeComponents: new Map<string, React.ComponentType>(),
  useAgentSessions: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => {
  type RouteFactoryOptions = { component?: React.ComponentType };
  function registerRoute(path: string, options: RouteFactoryOptions) {
    if (options.component) mocks.routeComponents.set(path, options.component);
    return { ...options };
  }
  return {
    createFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
  };
});

vi.mock('@/hooks/useAgentSessions', () => ({
  useAgentSessions: mocks.useAgentSessions,
}));

vi.mock('@/components/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/shared/FeatureDisabledPage', () => ({
  FeatureDisabledPage: ({ feature }: { feature: string }) =>
    React.createElement('div', { 'data-testid': 'feature-disabled' }, `${feature} disabled`),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Import the component so the route registers itself
import '../index.tsx';

function getComponent(): React.ComponentType {
  const comp = mocks.routeComponents.get('/agent-activity/');
  if (!comp) throw new Error('AgentActivityPage not registered');
  return comp;
}

function renderPage() {
  const Page = getComponent();
  return renderWithProviders(React.createElement(Page));
}

const mockSession = {
  id: 'ses_123',
  provider: 'github',
  repository: 'org/repo',
  prNumber: 42,
  prBranch: 'agent/fix-123',
  baseBranch: 'main',
  prTitle: 'Fix issue 123',
  prAuthor: 'Agent',
  agentName: 'Automate',
  matchedRule: null,
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  closedAt: null,
  filesLastSyncedAt: null,
  fileSyncStatus: null,
  fileCount: 3,
  linkedRunCount: 1,
};

describe('AgentActivityPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the header and table when there are active sessions', () => {
    mocks.useAgentSessions.mockReturnValue({
      data: [mockSession],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();
    expect(screen.getByText('Agent Activity')).toBeInTheDocument();
    expect(screen.getByText('Automate')).toBeInTheDocument(); // Agent name
    expect(screen.getByText('org/repo')).toBeInTheDocument(); // Repo
    expect(screen.getByText('#42')).toBeInTheDocument(); // PR number
    expect(screen.getByText('agent/fix-123')).toBeInTheDocument(); // Branch
    expect(screen.getByText('active')).toBeInTheDocument(); // Status
    expect(screen.getByText('3')).toBeInTheDocument(); // Changed files
    expect(screen.getAllByText('1')[0]).toBeInTheDocument(); // Linked runs
  });

  it('renders loading state', () => {
    mocks.useAgentSessions.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();
    // Assuming RunListSkeleton adds an element with a role or class. For simplicity, just test that the table isn't there and we don't crash.
    expect(screen.queryByText('Agent')).toBeNull(); 
  });

  it('renders error state', () => {
    mocks.useAgentSessions.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load sessions'),
      refetch: vi.fn(),
    });

    renderPage();
    expect(screen.getByText('Failed to load sessions')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    mocks.useAgentSessions.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();
    expect(screen.getByText('No AI agent PRs are being tracked yet')).toBeInTheDocument();
  });
});
