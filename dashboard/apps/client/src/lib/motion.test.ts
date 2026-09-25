/// <reference types="vitest" />
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  spring,
  ease,
  stagger,
  fadeSlideUp,
  panelSlideIn,
  commandPalette,
  statusPassed,
  statusFailed,
  counterFlip,
  safeMotion,
} from './motion';

describe('motion constants', () => {
  it('spring presets exist with correct types', () => {
    expect(spring.snappy).toBeDefined();
    expect(spring.snappy.type).toBe('spring');
    expect(spring.snappy.stiffness).toBe(500);
    expect(spring.snappy.damping).toBe(35);

    expect(spring.smooth).toBeDefined();
    expect(spring.smooth.type).toBe('spring');
    expect(spring.smooth.stiffness).toBe(280);
    expect(spring.smooth.damping).toBe(28);

    expect(spring.slow).toBeDefined();
    expect(spring.slow.type).toBe('spring');
    expect(spring.slow.stiffness).toBe(160);
    expect(spring.slow.damping).toBe(26);
  });

  it('ease presets exist with correct types', () => {
    expect(ease.fast).toBeDefined();
    expect(ease.fast.duration).toBe(0.06);
    expect(ease.fast.ease).toEqual([0.16, 1, 0.3, 1]);

    expect(ease.standard).toBeDefined();
    expect(ease.standard.duration).toBe(0.15);
    expect(ease.standard.ease).toEqual([0.16, 1, 0.3, 1]);
  });

  it('stagger presets exist', () => {
    expect(stagger.list).toBeDefined();
    expect(stagger.list.delayChildren).toBe(0.02);
    expect(stagger.list.staggerChildren).toBe(0.04);
  });

  it('fadeSlideUp variant has hidden and visible states', () => {
    expect(fadeSlideUp.hidden).toEqual({ opacity: 0, y: 6 });
    expect(fadeSlideUp.visible).toBeDefined();
  });

  it('panelSlideIn variant has hidden, visible, and exit states', () => {
    expect(panelSlideIn.hidden).toBeDefined();
    expect(panelSlideIn.visible).toBeDefined();
    expect(panelSlideIn.exit).toBeDefined();
  });

  it('commandPalette variant has hidden, visible, and exit states', () => {
    expect(commandPalette.hidden).toBeDefined();
    expect(commandPalette.visible).toBeDefined();
    expect(commandPalette.exit).toBeDefined();
  });

  it('statusPassed variant has hidden and visible states', () => {
    expect(statusPassed.hidden).toBeDefined();
    expect(statusPassed.visible).toBeDefined();
  });

  it('statusFailed variant has hidden and visible states', () => {
    expect(statusFailed.hidden).toBeDefined();
    expect(statusFailed.visible).toBeDefined();
  });

  it('counterFlip variant has hidden, visible, and exit states', () => {
    expect(counterFlip.hidden).toBeDefined();
    expect(counterFlip.visible).toBeDefined();
    expect(counterFlip.exit).toBeDefined();
  });
});

describe('safeMotion()', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it('returns the variant when reduced motion is NOT preferred', () => {
    globalThis.window = {
      ...originalWindow,
      matchMedia: vi.fn().mockReturnValue({ matches: false }),
    } as unknown as Window & typeof globalThis;

    const result = safeMotion(fadeSlideUp);
    expect(result).toBe(fadeSlideUp);
  });

  it('returns empty object when reduced motion IS preferred', () => {
    globalThis.window = {
      ...originalWindow,
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    } as unknown as Window & typeof globalThis;

    const result = safeMotion(fadeSlideUp);
    expect(result).toEqual({});
  });

  it('returns empty object when window is undefined (SSR)', () => {
    const saved = globalThis.window;
    // @ts-expect-error — simulate SSR
    delete globalThis.window;

    const result = safeMotion(fadeSlideUp);
    expect(result).toEqual({});

    globalThis.window = saved;
  });

  it('queries the correct media query', () => {
    const mockMatchMedia = vi.fn().mockReturnValue({ matches: false });
    globalThis.window = {
      ...originalWindow,
      matchMedia: mockMatchMedia,
    } as unknown as Window & typeof globalThis;

    safeMotion(fadeSlideUp);
    expect(mockMatchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });
});
