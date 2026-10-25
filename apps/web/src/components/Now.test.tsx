import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../lib/api.js';
import { MAX_ATTENTION, isNew, rankAttention } from '../lib/attention.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { LAST_VISIT_KEY, NowPage, type NowSources } from './Now.js';

const NOW = new Date('2026-10-25T12:00:00.000Z');

function run(overrides: Partial<Run>): Run {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    suite: 'checkout e2e',
    testType: 'browser',
    branch: 'main',
    phase: 'complete',
    outcome: 'passed',
    createdAt: '2026-10-25T11:00:00.000Z',
    startedAt: '2026-10-25T11:00:00.000Z',
    completedAt: '2026-10-25T11:05:00.000Z',
    ...overrides,
  } as Run;
}

const entry = (overrides: Record<string, unknown>) =>
  ({
    projectId: 'p1',
    slug: 'svc',
    name: 'Service',
    letter: 'B',
    score: 80,
    incomplete: false,
    limiter: null,
    trend: 0,
    worst: null,
    lastReportAt: '2026-10-25T10:00:00.000Z',
    ...overrides,
  }) as never;

describe('rankAttention', () => {
  it('puts failures first, one per suite, newest first, then cautions', () => {
    const ranked = rankAttention({
      runs: [
        run({
          id: 'a'.repeat(8),
          outcome: 'failed',
          createdAt: '2026-10-25T09:00:00.000Z',
          completedAt: '2026-10-25T09:05:00.000Z',
        }),
        run({ id: 'b'.repeat(8), outcome: 'failed', createdAt: '2026-10-25T11:00:00.000Z' }),
        run({ id: 'c'.repeat(8), outcome: 'blocked', suite: null, testType: 'api', branch: null }),
        run({
          id: 'd'.repeat(8),
          phase: 'running',
          outcome: null,
          startedAt: '2026-10-25T09:00:00.000Z',
        }),
        run({
          id: 'e'.repeat(8),
          phase: 'running',
          outcome: null,
          startedAt: '2026-10-25T11:55:00.000Z',
        }),
        run({ id: 'f'.repeat(8) }),
      ],
      portfolio: {
        projects: [
          entry({ projectId: 'p1', letter: 'D', limiter: 'Limited by Security' }),
          entry({ projectId: 'p2', name: 'Web', letter: 'B', trend: -3, lastReportAt: null }),
          entry({ projectId: 'p3', name: 'Ok', letter: 'A' }),
        ],
      },
      deliveries: [
        {
          id: 'd1',
          status: 'failed',
          errorCode: 'telegram_rejected_401',
          scheduledFor: '2026-10-25T09:00:00.000Z',
        } as never,
        {
          id: 'd2',
          status: 'failed',
          errorCode: null,
          scheduledFor: '2026-10-24T09:00:00.000Z',
        } as never,
      ],
      now: NOW,
    });
    expect(ranked.total).toBe(6);
    expect(ranked.items).toHaveLength(MAX_ATTENTION);
    expect(ranked.items.map((item) => item.severity)).toEqual([
      'bad',
      'bad',
      'bad',
      'caution',
      'caution',
    ]);
    expect(ranked.items[0]?.title).toBe('checkout e2e failed');
    expect(ranked.items[0]?.action.to).toBe('/dashboard/runs/bbbbbbbb');
    expect(ranked.items.some((item) => item.title === 'api failed')).toBe(true);
    expect(ranked.items.some((item) => item.title === 'Service is graded D')).toBe(true);
  });

  it('says how many reports did not arrive, and names a stuck run', () => {
    const ranked = rankAttention({
      runs: [run({ phase: 'running', outcome: null, startedAt: '2026-10-25T09:00:00.000Z' })],
      portfolio: null,
      deliveries: [
        {
          id: 'd1',
          status: 'failed',
          errorCode: null,
          scheduledFor: '2026-10-25T09:00:00.000Z',
        } as never,
        {
          id: 'd2',
          status: 'failed',
          errorCode: null,
          scheduledFor: '2026-10-24T09:00:00.000Z',
        } as never,
      ],
      now: NOW,
    });
    expect(ranked.items.map((item) => item.title)).toEqual([
      'checkout e2e has been running over an hour',
      '2 reports did not arrive',
    ]);
    expect(ranked.items[1]?.detail).toBe('Delivery failed');
    expect(
      rankAttention({
        runs: [],
        portfolio: null,
        deliveries: [
          {
            id: 'x',
            status: 'failed',
            errorCode: 'e',
            scheduledFor: '2026-10-25T09:00:00.000Z',
          } as never,
        ],
        now: NOW,
      }).items[0]?.title,
    ).toBe('A report did not arrive');
  });

  it('marks only what happened since the last visit', () => {
    const [item] = rankAttention({
      runs: [run({ outcome: 'failed' })],
      portfolio: null,
      deliveries: [],
      now: NOW,
    }).items;
    expect(item && isNew(item, '2026-10-25T10:00:00.000Z')).toBe(true);
    expect(item && isNew(item, '2026-10-25T11:30:00.000Z')).toBe(false);
    expect(item && isNew(item, null)).toBe(false);
  });
});

function sources(overrides: Partial<NowSources> = {}): NowSources {
  return {
    runs: vi.fn(async () => [run({ outcome: 'failed' })]),
    portfolio: vi.fn(async () => ({ projects: [] })),
    deliveries: vi.fn(async () => []),
    ...overrides,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe('NowPage', () => {
  it('shows the one big number, the item, and opens it with its one action', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    localStorage.setItem(LAST_VISIT_KEY, '2026-10-25T10:00:00.000Z');
    const { container } = render(
      <NowPage sources={sources()} navigate={navigate} now={() => NOW} />,
    );
    expect(await screen.findByTestId('now-status')).toHaveTextContent('1thing needs you.');
    expect(screen.getByText('new')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Open run' })[1] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/dashboard/runs/00000000-0000-4000-8000-000000000001');
    await user.click(screen.getAllByRole('button', { name: 'Open run' })[0] as HTMLElement);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(LAST_VISIT_KEY)).toBe(NOW.toISOString());
    await expectNoBlockingAxeViolations(container);
  });

  it('says all clear when nothing needs anyone', async () => {
    render(
      <NowPage
        sources={sources({ runs: vi.fn(async () => []) })}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    expect(await screen.findByTestId('now-clear')).toHaveTextContent('All clear');
    expect(screen.getByTestId('now-status')).toHaveTextContent('Nothing needs you.');
  });

  it('counts what did not fit, and says when a source could not be read', async () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      run({ id: `${String(index)}`.repeat(8), suite: `suite ${String(index)}`, outcome: 'failed' }),
    );
    render(
      <NowPage
        sources={sources({
          runs: vi.fn(async () => many),
          portfolio: vi.fn(async () => Promise.reject(new Error('offline'))),
        })}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    expect(await screen.findByText('+2 more. Fix these first.')).toBeTruthy();
    expect(screen.getByText(/could not be read/u)).toBeTruthy();
    expect(screen.getByTestId('now-status')).toHaveTextContent('7things need you.');
  });

  it('shows a loading state, and ignores an answer after unmount', async () => {
    let resolve: (value: Run[]) => void = () => undefined;
    const slow = sources({ runs: vi.fn(() => new Promise<Run[]>((done) => (resolve = done))) });
    const { unmount } = render(<NowPage sources={slow} navigate={vi.fn()} />);
    expect(screen.getByTestId('now-loading')).toBeTruthy();
    unmount();
    resolve([]);
    await waitFor(() => expect(slow.runs).toHaveBeenCalled());
    expect(localStorage.getItem(LAST_VISIT_KEY)).toBeNull();
  });
});
