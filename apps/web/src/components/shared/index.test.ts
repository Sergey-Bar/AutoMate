/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, it, vi } from 'vitest';
import * as sharedIndex from './index.js';

// Mock framer-motion for EmptyState (which uses it)
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children }: { children?: React.ReactNode }) =>
      (require('react') as typeof import('react')).createElement('div', {}, children),
    path: (props: Record<string, unknown>) =>
      (require('react') as typeof import('react')).createElement('path', props),
    circle: (props: Record<string, unknown>) =>
      (require('react') as typeof import('react')).createElement('circle', props),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/motion.js', () => ({
  prefersReducedMotion: vi.fn(() => false),
  reducedMotionSafe: vi.fn((v: unknown) => v),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: () =>
    (require('react') as typeof import('react')).createElement('span', {}),
  RefreshCw: () =>
    (require('react') as typeof import('react')).createElement('span', {}),
  Bug: () =>
    (require('react') as typeof import('react')).createElement('span', {}),
  WifiOff: () =>
    (require('react') as typeof import('react')).createElement('span', {}),
}));

describe('Shared index barrel exports', () => {
  it('exports Skeleton as a named function component', () => {
    expect(sharedIndex.Skeleton).toBeDefined();
    expect(typeof sharedIndex.Skeleton).toBe('function');
    expect(sharedIndex.Skeleton.name).toBe('Skeleton');
  });

  it('exports MessageListSkeleton as a named function component', () => {
    expect(sharedIndex.MessageListSkeleton).toBeDefined();
    expect(typeof sharedIndex.MessageListSkeleton).toBe('function');
    expect(sharedIndex.MessageListSkeleton.name).toBe('MessageListSkeleton');
  });

  it('exports ConversationListSkeleton as a named function component', () => {
    expect(sharedIndex.ConversationListSkeleton).toBeDefined();
    expect(typeof sharedIndex.ConversationListSkeleton).toBe('function');
    expect(sharedIndex.ConversationListSkeleton.name).toBe('ConversationListSkeleton');
  });

  it('exports TextSkeleton as a named function component', () => {
    expect(sharedIndex.TextSkeleton).toBeDefined();
    expect(typeof sharedIndex.TextSkeleton).toBe('function');
    expect(sharedIndex.TextSkeleton.name).toBe('TextSkeleton');
  });

  it('exports CardSkeleton as a named function component', () => {
    expect(sharedIndex.CardSkeleton).toBeDefined();
    expect(typeof sharedIndex.CardSkeleton).toBe('function');
    expect(sharedIndex.CardSkeleton.name).toBe('CardSkeleton');
  });

  it('exports SettingsSkeleton as a named function component', () => {
    expect(sharedIndex.SettingsSkeleton).toBeDefined();
    expect(typeof sharedIndex.SettingsSkeleton).toBe('function');
    expect(sharedIndex.SettingsSkeleton.name).toBe('SettingsSkeleton');
  });

  it('exports EmptyState as a named function component', () => {
    expect(sharedIndex.EmptyState).toBeDefined();
    expect(typeof sharedIndex.EmptyState).toBe('function');
    expect(sharedIndex.EmptyState.name).toBe('EmptyState');
  });

  it('exports ErrorBoundary as a class component with render method', () => {
    expect(sharedIndex.ErrorBoundary).toBeDefined();
    expect(typeof sharedIndex.ErrorBoundary).toBe('function');
    // Class components have a prototype with render and lifecycle methods
    expect(sharedIndex.ErrorBoundary.prototype).toHaveProperty('render');
  });
});
