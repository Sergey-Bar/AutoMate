/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, it, vi } from 'vitest';
import * as layoutIndex from './index.js';

// Mock dependencies needed by AppLayout
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    (require('react') as typeof import('react')).createElement('a', { href: to }, children),
  Outlet: () =>
    (require('react') as typeof import('react')).createElement('div', {}),
}));

vi.mock('./ThemeToggle.js', () => ({
  ThemeToggle: () =>
    (require('react') as typeof import('react')).createElement('div', {}),
}));

vi.mock('../chat/conversation-sidebar.js', () => ({
  ConnectedConversationSidebar: () =>
    (require('react') as typeof import('react')).createElement('div', {}),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children }: { children?: React.ReactNode }) =>
      (require('react') as typeof import('react')).createElement('div', {}, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/motion.js', () => ({
  prefersReducedMotion: vi.fn(() => false),
  reducedMotionSafe: vi.fn((v: unknown) => v),
  spring: {},
  messageBubble: {},
}));

describe('Layout index barrel exports', () => {
  it('exports ThemeToggle', () => {
    expect(layoutIndex.ThemeToggle).toBeDefined();
    expect(typeof layoutIndex.ThemeToggle).toBe('function');
  });

  it('exports PageTransition', () => {
    expect(layoutIndex.PageTransition).toBeDefined();
    expect(typeof layoutIndex.PageTransition).toBe('function');
  });

  it('exports AppLayout', () => {
    expect(layoutIndex.AppLayout).toBeDefined();
    expect(typeof layoutIndex.AppLayout).toBe('function');
  });
});
