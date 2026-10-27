import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TestHistory } from '@automate/shared-contracts';
import { makeApi } from '../../test-utils.js';
import { testHistoryPath } from '../../route-manifest.js';
import { TestHistoryPage } from './test-history.js';

const KEY = 'tests/pay.spec.ts › Checkout › pays [webkit]';

function page(overrides: Partial<TestHistory> = {}): TestHistory {
  return {
    key: KEY,
    title: 'pays',
    file: 'tests/pay.spec.ts',
    days: 90,
    entries: [
      {
        runId: 'r3',
        startedAt: '2026-10-26T10:00:00.000Z',
        status: 'failed',
        durationMs: 30,
        branch: 'main',
        commitSha: 'abcdef1234567',
        error: 'Timeout 5000ms exceeded',
        signature: 'timeout <n>ms exceeded',
      },
      {
        runId: 'r2',
        startedAt: '2026-10-25T10:00:00.000Z',
        status: 'passed',
        durationMs: 20,
        branch: 'main',
        commitSha: 'abcdef1234566',
        error: null,
        signature: null,
      },
    ],
    nextBefore: '2026-10-25T10:00:00.000Z',
    signatures: [
      { signature: 'timeout <n>ms exceeded', count: 1, example: 'Timeout 5000ms exceeded' },
    ],
    ...overrides,
  };
}

describe('TestHistoryPage', () => {
  it('shows the outcome strip oldest first, the causes, and pages to older runs', async () => {
    const older = page({
      entries: [
        {
          runId: 'r1',
          startedAt: '2026-10-24T10:00:00.000Z',
          status: 'flaky',
          durationMs: 25,
          branch: 'main',
          commitSha: null,
          error: null,
          signature: null,
        },
      ],
      nextBefore: null,
      signatures: [],
    });
    const getTestHistory = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(older);
    render(<TestHistoryPage testKey={KEY} api={makeApi({ getTestHistory })} />);
    const strip = await screen.findByTestId('test-strip');
    expect(
      within(strip)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual([expect.stringMatching(/^passed/u), expect.stringMatching(/^failed/u)]);
    expect(screen.getByTestId('test-signatures')).toHaveTextContent('1× Timeout 5000ms exceeded');
    expect(getTestHistory).toHaveBeenCalledWith(KEY, {});
    fireEvent.click(screen.getByTestId('test-history-more'));
    await screen.findByText('flaky');
    expect(getTestHistory).toHaveBeenLastCalledWith(KEY, { before: '2026-10-25T10:00:00.000Z' });
    expect(screen.queryByTestId('test-history-more')).toBeNull();
  });

  it('says so when the test has no result, and when it cannot be read', async () => {
    const { unmount } = render(
      <TestHistoryPage
        testKey={KEY}
        api={makeApi({
          getTestHistory: vi.fn(async () =>
            page({ entries: [], nextBefore: null, signatures: [] }),
          ),
        })}
      />,
    );
    expect(await screen.findByTestId('test-history-empty')).toHaveTextContent(
      'No result in the last 90 days.',
    );
    unmount();
    render(
      <TestHistoryPage
        testKey={KEY}
        api={makeApi({ getTestHistory: vi.fn(async () => Promise.reject(new Error('refused'))) })}
      />,
    );
    expect(await screen.findByTestId('test-history-error')).toHaveTextContent('refused');
  });

  it('links by identity, encoded, because the identity is a path', () => {
    expect(testHistoryPath(KEY)).toBe(`/dashboard/test?key=${encodeURIComponent(KEY)}`);
  });
});
