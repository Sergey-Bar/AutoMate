import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal, transition } from './state-machine.js';
import { nextOccurrence } from './schedule.js';

describe('orchestration state machine', () => {
  it('allows lifecycle transitions and rejects terminal overwrites', () => {
    expect(canTransition('queued', 'leased')).toBe(true);
    expect(transition('running', 'succeeded')).toBe('succeeded');
    expect(isTerminal('succeeded')).toBe(true);
    expect(() => transition('succeeded', 'failed')).toThrow();
  });

  it('calculates interval schedules deterministically', () => {
    const from = new Date('2026-09-25T00:00:00.000Z');
    expect(nextOccurrence({ minute: 'step', hour: '*' }, from, 15)?.toISOString()).toBe(
      '2026-09-25T00:15:00.000Z',
    );
    expect(() => nextOccurrence({ minute: 99, hour: 0 }, from)).toThrow();
    expect(nextOccurrence({ minute: 30, hour: 2 }, from)?.toISOString()).toBe(
      '2026-09-25T02:30:00.000Z',
    );
    expect(
      nextOccurrence({ minute: 30, hour: 2 }, new Date('2026-09-25T03:00:00.000Z'))?.toISOString(),
    ).toBe('2026-09-26T02:30:00.000Z');
    expect(() => nextOccurrence({ minute: 30, hour: 99 }, from)).toThrow();
  });
});
