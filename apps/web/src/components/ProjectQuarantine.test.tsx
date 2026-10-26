import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectQuarantine as View } from '@automate/shared-contracts';
import { makeHealthDouble } from '../test-utils.js';
import { ProjectQuarantine, seconds } from './ProjectQuarantine.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';

function view(overrides: Partial<View> = {}): View {
  return {
    policy: { mode: 'auto', releaseAfter: 20 },
    windowDays: 30,
    entries: [
      {
        id: 'q1',
        testTitle: 'pays',
        testFile: 'tests/pay.spec.ts',
        stableId: 'tests/pay.spec.ts › pays [webkit]',
        status: 'approved',
        quarantinedBy: 'automate',
        reason: 'Disagreed with itself',
        quarantinedAt: '2026-10-20T00:00:00.000Z',
        releasedAt: null,
        owner: '@payments-team',
        daysQuarantined: 6,
        retriesSpent: 4,
        wastedMs: 5_333,
        blockedRuns: 2,
        cleanStreak: 7,
      },
    ],
    ...overrides,
  };
}

describe('ProjectQuarantine', () => {
  it('shows each entry with its owner, cost, age and release streak', async () => {
    const health = makeHealthDouble('admin', { getProjectQuarantine: vi.fn(async () => view()) });
    render(<ProjectQuarantine health={health} projectId={PROJECT} />);
    const row = await screen.findByTestId('project-quarantine-q1');
    expect(row).toHaveTextContent('@payments-team');
    expect(row).toHaveTextContent('4 retries · 5.3 s · 2 blocked');
    expect(row).toHaveTextContent('6 d');
    expect(row).toHaveTextContent('7 / 20');
    expect(row).toHaveTextContent('approved · auto');
    expect(screen.getByTestId('project-quarantine-policy')).toHaveTextContent(
      'Release after 20 clean passes.',
    );
  });

  it('sets the policy and reads it back, and shows a refusal', async () => {
    const setQuarantinePolicy = vi.fn(async () => ({ mode: 'suggest' as const, releaseAfter: 20 }));
    const getProjectQuarantine = vi
      .fn()
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce(view({ policy: { mode: 'suggest', releaseAfter: 20 } }));
    const health = makeHealthDouble('admin', { getProjectQuarantine, setQuarantinePolicy });
    render(<ProjectQuarantine health={health} projectId={PROJECT} />);
    const group = await screen.findByRole('group', { name: 'Quarantine policy' });
    fireEvent.click(within(group).getByRole('button', { name: 'Suggest' }));
    await waitFor(() =>
      expect(setQuarantinePolicy).toHaveBeenCalledWith(PROJECT, {
        mode: 'suggest',
        releaseAfter: 20,
      }),
    );
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: 'Suggest' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );

    setQuarantinePolicy.mockRejectedValueOnce(new Error('Only an admin can change this'));
    fireEvent.click(within(group).getByRole('button', { name: 'Auto' }));
    expect(await screen.findByTestId('project-quarantine-refused')).toHaveTextContent(
      'Only an admin can change this',
    );
  });

  it('says so when nothing is quarantined, and when the view cannot be read', async () => {
    const empty = makeHealthDouble('viewer', {
      getProjectQuarantine: vi.fn(async () => view({ entries: [] })),
    });
    const { unmount } = render(<ProjectQuarantine health={empty} projectId={PROJECT} />);
    expect(await screen.findByText('No test of this project is quarantined.')).toBeInTheDocument();
    unmount();
    const broken = makeHealthDouble('viewer', {
      getProjectQuarantine: vi.fn(async () => Promise.reject(new Error('not configured'))),
    });
    render(<ProjectQuarantine health={broken} projectId={PROJECT} />);
    expect(await screen.findByTestId('project-quarantine-error')).toHaveTextContent(
      'not configured',
    );
  });

  it('writes a duration in seconds under a minute and minutes above', () => {
    expect(seconds(5_333)).toBe('5.3 s');
    expect(seconds(180_000)).toBe('3 min');
  });
});
