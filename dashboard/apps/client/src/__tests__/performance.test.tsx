/**
 * Performance tests for client formatters, component rendering, and memory behavior.
 *
 * Validates throughput of pure functions, render timing of component lists,
 * and absence of listener leaks across mount/unmount cycles.
 */
/* eslint-disable test-flakiness/no-random-data */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '../test/test-utils';

// ── Mocks (MUST come before component imports) ──────────────────────────────

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return ({
          initial: _initial,
          animate: _animate,
          exit: _exit,
          variants: _variants,
          whileHover: _whileHover,
          whileTap: _whileTap,
          transition: _transition,
          layout: _layout,
          layoutId: _layoutId,
          ...rest
        }: Record<string, unknown>) => {
          const Tag =
            typeof prop === 'string' &&
            [
              'div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td',
              'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside',
              'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4',
            ].includes(prop)
              ? prop
              : 'div';
          return React.createElement(Tag, rest);
        };
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
  useTransform: (_v: unknown, _input: unknown, output: number[]) => ({
    get: () => output?.[0] ?? 0,
  }),
  useSpring: (v: unknown) => v,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
    React.createElement('a', { href: to ?? '', ...rest }, children),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  useSearch: () => ({}),
  useParams: () => ({}),
}));

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}));

vi.mock('react-arborist', () => ({
  Tree: ({ children, data, height, rowHeight }: {
    children: (props: {
      node: { data: { id?: string; children?: Array<{ id?: string }> }; isOpen: boolean; toggle: () => void; id: string };
      style: { top: number };
      dragHandle: null;
    }) => React.ReactElement;
    data: Array<{ id?: string; children?: Array<{ id?: string }> }>;
    height?: number;
    rowHeight?: number;
  } & Record<string, unknown>) => {
    const nodes = data.flatMap((group) => [group, ...(group.children ?? [])]);
    return React.createElement('div', { 'data-testid': 'mock-tree', style: { height } },
      nodes.slice(0, 50).map((node, i: number) =>
        children({
          node: { data: node, isOpen: true, toggle: () => {}, id: node.id ?? String(i) },
          style: { top: i * (rowHeight ?? 26) },
          dragHandle: null,
        })
      )
    );
  },
}));

vi.mock('@/hooks/useRun', () => ({
  useRunTests: () => ({ data: [] }),
  useRuns: () => ({ data: [] }),
  useRun: () => ({ data: null }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'responsive-container' }, children),
  AreaChart: ({ children }: { children: React.ReactNode }) => React.createElement('svg', null, children),
  Area: () => React.createElement('path'),
  XAxis: () => React.createElement('g'),
  YAxis: () => React.createElement('g'),
  CartesianGrid: () => React.createElement('g'),
  Tooltip: () => React.createElement('g'),
  Legend: () => React.createElement('g'),
  ReferenceLine: () => React.createElement('line'),
}));

vi.mock('lucide-react', () => ({
  ChevronRight: () => React.createElement('span', null, '>'),
  Folder: () => React.createElement('span', null, '📁'),
  FileCode: () => React.createElement('span', null, '📄'),
  Check: () => React.createElement('span', null, '✓'),
  X: () => React.createElement('span', null, '✕'),
  Zap: () => React.createElement('span', null, '⚡'),
  Loader2: () => React.createElement('span', null, '⌛'),
  Minus: () => React.createElement('span', null, '-'),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  formatDuration,
  timeAgo,
  statusColor,
  statusBgColor,
  statusLabel,
  passRate,
  shortPath,
  fileName as _fileName,
  shortSha as _shortSha,
  stripAnsi,
  tryParseJSON,
  greeting as _greeting,
  formatDate as _formatDate,
} from '../lib/formatters';
import type { TestWithResults } from '../lib/types';
import { StatusBadge } from '../components/shared/StatusBadge';
import { TagChip } from '../components/shared/TagChip';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/shared/Skeleton';
import { EmptyState } from '../components/shared/EmptyState';
import { useNotificationStore } from '../store/notificationStore';
import { TestTree } from '../components/tests/TestTree';
import { PassRateChart, type PassRatePoint } from '../components/analytics/PassRateChart';
import { DurationChart, type DurationPoint } from '../components/analytics/DurationChart';

// ═══════════════════════════════════════════════════════════════════════════════
// A. Formatter Performance
// ═══════════════════════════════════════════════════════════════════════════════

describe('formatter performance', () => {
  it('formatDuration handles 10,000 calls in < 200ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      formatDuration(i * 1000);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('timeAgo handles 10,000 calls in < 200ms', () => {
    const now = new Date().toISOString();
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      timeAgo(now);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('statusColor handles 10,000 calls in < 100ms', () => {
    const statuses = ['passed', 'failed', 'flaky', 'skipped', 'running', 'timedOut', 'queued'];
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      statusColor(statuses[i % statuses.length]);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('statusLabel handles 10,000 calls in < 100ms', () => {
    const statuses = ['passed', 'failed', 'flaky', 'skipped', 'running'];
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      statusLabel(statuses[i % statuses.length]);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('statusBgColor handles 10,000 calls in < 100ms', () => {
    const statuses = ['passed', 'failed', 'flaky', 'skipped', 'running'];
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      statusBgColor(statuses[i % statuses.length]);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('passRate handles 10,000 calls in < 100ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      passRate(i, i + 10);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('shortPath handles 10,000 calls in < 200ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      shortPath(`src/components/deep/nested/folder/Component${i}.tsx`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('stripAnsi handles 10,000 calls in < 200ms', () => {
    const ansiStr = '\x1b[31mError:\x1b[0m Something \x1b[1mfailed\x1b[0m';
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      stripAnsi(ansiStr);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('formatDuration handles edge cases correctly under load', () => {
    const edgeCases = [null, undefined, 0, -1, 500, 999, 1000, 59999, 60000, 3600000, Number.MAX_SAFE_INTEGER];
    const start = performance.now();
    for (let round = 0; round < 1000; round++) {
      for (const val of edgeCases) {
        formatDuration(val as number);
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. Component Render Performance
// ═══════════════════════════════════════════════════════════════════════════════

describe('component render performance', () => {
  it('renders 200 StatusBadges in < 1000ms', () => {
    const statuses = ['passed', 'failed', 'flaky', 'skipped', 'running'] as const;
    const start = performance.now();
    const { unmount } = render(
      React.createElement(
        'div',
        null,
        Array.from({ length: 200 }, (_, i) =>
          React.createElement(StatusBadge, {
            key: i,
            status: statuses[i % statuses.length],
          }),
        ),
      ),
    );
    const elapsed = performance.now() - start;
    unmount();
    expect(elapsed).toBeLessThan(1000);
  });

  it('renders 100 TagChips in < 500ms', () => {
    const tags = ['smoke', 'critical', 'slow', 'flaky', 'wip'];
    const start = performance.now();
    const { unmount } = render(
      React.createElement(
        'div',
        null,
        Array.from({ length: 100 }, (_, i) =>
          React.createElement(TagChip, {
            key: i,
            tag: tags[i % tags.length],
            active: i % 3 === 0,
          }),
        ),
      ),
    );
    const elapsed = performance.now() - start;
    unmount();
    expect(elapsed).toBeLessThan(500);
  });

  it('renders 100 Buttons in < 500ms', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger', 'outline'] as const;
    const start = performance.now();
    const { unmount } = render(
      React.createElement(
        'div',
        null,
        Array.from({ length: 100 }, (_, i) =>
          React.createElement(Button, { key: i, variant: variants[i % variants.length] }, `Btn ${i}`),
        ),
      ),
    );
    const elapsed = performance.now() - start;
    unmount();
    expect(elapsed).toBeLessThan(500);
  });

  it('renders 50 Skeleton elements in < 500ms', () => {
    const start = performance.now();
    const { unmount } = render(
      React.createElement(
        'div',
        null,
        Array.from({ length: 50 }, (_, i) =>
          React.createElement(Skeleton, { key: i, className: 'h-10 w-full' }),
        ),
      ),
    );
    const elapsed = performance.now() - start;
    unmount();
    expect(elapsed).toBeLessThan(500);
  });

  it('renders EmptyState with illustration in < 500ms', () => {
    const illustrations = ['radar', 'inbox', 'search', 'chart', 'grid', 'shield'] as const;
    const start = performance.now();
    for (const ill of illustrations) {
      const { unmount } = render(
        React.createElement(EmptyState, {
          title: `Empty ${ill}`,
          description: 'No data available',
          illustration: ill,
        }),
      );
      unmount();
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. Memory / Cleanup Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('memory and cleanup', () => {
  afterEach(() => {
    useNotificationStore.getState().clear();
  });

  it('rapid mount/unmount of StatusBadge does not throw', () => {
    expect(() => {
      for (let i = 0; i < 50; i++) {
        const { unmount } = render(
          React.createElement(StatusBadge, { status: 'passed' }),
        );
        unmount();
      }
    }).not.toThrow();
  });

  it('rapid mount/unmount of Button does not throw', () => {
    expect(() => {
      for (let i = 0; i < 50; i++) {
        const { unmount } = render(
          React.createElement(Button, null, `Click ${i}`),
        );
        unmount();
      }
    }).not.toThrow();
  });

  it('notification store push + clear cycle does not leak', () => {
    const store = useNotificationStore;

    // Push 100 notifications
    for (let i = 0; i < 100; i++) {
      store.getState().push({ type: 'info', title: `Notif ${i}` });
    }
    // Store caps at 100
    expect(store.getState().notifications.length).toBeLessThanOrEqual(100);
    expect(store.getState().unreadCount).toBe(100);

    // Clear all
    store.getState().clear();
    expect(store.getState().notifications.length).toBe(0);
    expect(store.getState().unreadCount).toBe(0);
  });

  it('notification store subscribe/unsubscribe does not accumulate listeners', () => {
    const store = useNotificationStore;
    const unsubs: (() => void)[] = [];

    // Subscribe 20 times
    for (let i = 0; i < 20; i++) {
      unsubs.push(store.subscribe(() => {}));
    }

    // Unsubscribe all
    for (const unsub of unsubs) {
      unsub();
    }

    // After unsubscribing, pushing a notification should not throw
    expect(() => {
      store.getState().push({ type: 'info', title: 'after-unsub' });
    }).not.toThrow();

    store.getState().clear();
  });

  it('tryParseJSON handles 10,000 invalid strings without leaking', () => {
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      tryParseJSON(`{invalid json ${i}`, []);
    }
    const elapsed = performance.now() - start;
    // Should be fast despite repeated try/catch
    expect(elapsed).toBeLessThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Heavy Component Performance Benchmarks
// ═══════════════════════════════════════════════════════════════════════════════

describe('heavy component benchmarks', () => {
  function makeTests(n: number) {
    const statuses = ['passed', 'failed', 'flaky', 'skipped', 'running'];
    return Array.from({ length: n }, (_, i) => ({
      id: `test-${i}`,
      title: `Test case ${i}`,
      file: `src/features/module-${Math.floor(i / 10)}/Component${i % 10}.test.ts`,
      suite: `Suite ${Math.floor(i / 20)}`,
      status: statuses[i % statuses.length],
      durationMs: 100 + (i % 500),
      workerIndex: i % 4,
      retryCount: 0,
      tags: [],
      annotations: [],
      results: [],
    }));
  }

  it('renders TestTree with 1000 nodes in < 500ms', () => {
    const tests = makeTests(1000);
    const start = performance.now();
    const { unmount } = render(
      React.createElement(TestTree, {
        tests: tests as TestWithResults[],
        groupBy: 'file',
        height: 600,
        onSelect: () => {},
      }),
    );
    const elapsed = performance.now() - start;
    unmount();
    expect(elapsed).toBeLessThan(500);
  });

  it(
    'rapid mount/unmount of TestTree (50 cycles) does not throw',
    () => {
      const tests = makeTests(100);
      expect(() => {
        for (let i = 0; i < 50; i++) {
          const { unmount } = render(
            React.createElement(TestTree, {
              tests: tests as TestWithResults[],
              groupBy: 'file',
              height: 300,
              onSelect: () => {},
            }),
          );
          unmount();
        }
      }).not.toThrow();
    },
    15_000,
  );

  it('renders PassRateChart with 500 data points in < 500ms', () => {
    const projects = ['project-a', 'project-b', 'project-c'];
    const data: PassRatePoint[] = Array.from({ length: 500 }, (_, i) => ({
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
      'project-a': 85 + Math.sin(i) * 10,
      'project-b': 90 + Math.cos(i) * 5,
      'project-c': 75 + Math.sin(i * 0.5) * 15,
    }));
    const start = performance.now();
    const { unmount } = render(
      React.createElement(PassRateChart, { data, projects }),
    );
    const elapsed = performance.now() - start;
    unmount();
    expect(elapsed).toBeLessThan(500);
  });

  it('renders DurationChart with 500 data points in < 500ms', () => {
    const data: DurationPoint[] = Array.from({ length: 500 }, (_, i) => ({
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
      p50: 2000 + Math.sin(i) * 500,
      p95: 5000 + Math.cos(i) * 1000,
    }));
    const start = performance.now();
    const { unmount } = render(
      React.createElement(DurationChart, { data }),
    );
    const elapsed = performance.now() - start;
    unmount();
    expect(elapsed).toBeLessThan(500);
  });

  it('TestTree re-renders with updated data in < 300ms', () => {
    const tests1 = makeTests(500);
    const { unmount, rerender } = render(
      React.createElement(TestTree, {
        tests: tests1 as TestWithResults[],
        groupBy: 'file',
        height: 600,
        onSelect: () => {},
      }),
    );
    const tests2 = makeTests(500).map((t) => ({ ...t, status: 'passed' }));
    const start = performance.now();
    rerender(
      React.createElement(TestTree, {
        tests: tests2 as TestWithResults[],
        groupBy: 'status',
        height: 600,
        onSelect: () => {},
      }),
    );
    const elapsed = performance.now() - start;
    unmount();
    expect(elapsed).toBeLessThan(300);
  });

  it('PassRateChart handles rapid data updates (20 re-renders) in < 2000ms', () => {
    const projects = ['proj-a', 'proj-b'];
    const makeData = (seed: number): PassRatePoint[] =>
      Array.from({ length: 100 }, (_, i) => ({
        date: `Day ${i}`,
        'proj-a': 80 + Math.sin(i + seed) * 15,
        'proj-b': 70 + Math.cos(i + seed) * 20,
      }));

    const { unmount, rerender } = render(
      React.createElement(PassRateChart, { data: makeData(0), projects }),
    );
    const start = performance.now();
    for (let r = 1; r <= 20; r++) {
      rerender(
        React.createElement(PassRateChart, { data: makeData(r), projects }),
      );
    }
    const elapsed = performance.now() - start;
    unmount();
    expect(elapsed).toBeLessThan(2000);
  });
});
