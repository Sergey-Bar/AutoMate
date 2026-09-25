import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandPalette,
  counterFlip,
  ease,
  fadeSlideUp,
  messageBubble,
  panelSlideIn,
  prefersReducedMotion,
  reducedMotionSafe,
  safeMotion,
  spring,
  stagger,
  statusFailed,
  statusPassed,
  toolCardExpand,
} from './motion.js';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function setWindowMock(matches: boolean) {
  const matchMedia = vi.fn().mockReturnValue({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });

  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(globalThis.window ?? {}),
      matchMedia,
    },
    configurable: true,
    writable: true,
  });

  return matchMedia;
}

afterEach(() => {
  vi.restoreAllMocks();

  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

describe('motion presets', () => {
  it('exports variant objects with expected animation state keys', () => {
    expect(fadeSlideUp).toMatchObject({
      hidden: expect.any(Object),
      visible: expect.any(Object),
    });
    expect(panelSlideIn).toMatchObject({
      hidden: expect.any(Object),
      visible: expect.any(Object),
      exit: expect.any(Object),
    });
    expect(commandPalette).toMatchObject({
      hidden: expect.any(Object),
      visible: expect.any(Object),
      exit: expect.any(Object),
    });
    expect(statusPassed).toMatchObject({
      hidden: expect.any(Object),
      visible: expect.any(Object),
    });
    expect(statusFailed).toMatchObject({
      hidden: expect.any(Object),
      visible: expect.any(Object),
    });
    expect(counterFlip).toMatchObject({
      hidden: expect.any(Object),
      visible: expect.any(Object),
      exit: expect.any(Object),
    });
    expect(messageBubble).toMatchObject({
      hidden: expect.any(Object),
      visible: expect.any(Object),
    });
    expect(toolCardExpand).toMatchObject({
      hidden: expect.any(Object),
      visible: expect.any(Object),
      exit: expect.any(Object),
    });
  });

  it('exports spring presets with spring transition type', () => {
    expect(spring.snappy.type).toBe('spring');
    expect(spring.smooth.type).toBe('spring');
    expect(spring.slow.type).toBe('spring');
  });

  it('exports ease presets as duration-based transitions', () => {
    expect(ease.fast).toMatchObject({ duration: expect.any(Number), ease: expect.any(Array) });
    expect(ease.standard).toMatchObject({ duration: expect.any(Number), ease: expect.any(Array) });
    expect('type' in ease.fast).toBe(false);
    expect('type' in ease.standard).toBe(false);
  });

  it('exports stagger preset for list animation timings', () => {
    expect(stagger.list).toMatchObject({
      delayChildren: expect.any(Number),
      staggerChildren: expect.any(Number),
    });
  });
});

describe('reduced motion utilities', () => {
  it('prefersReducedMotion returns true when window is undefined (SSR)', () => {
    Reflect.deleteProperty(globalThis, 'window');
    expect(prefersReducedMotion()).toBe(true);
  });

  it('prefersReducedMotion returns true when matchMedia matches reduced motion', () => {
    const matchMedia = setWindowMock(true);

    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('prefersReducedMotion returns false when matchMedia does not match reduced motion', () => {
    const matchMedia = setWindowMock(false);

    expect(prefersReducedMotion()).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('reducedMotionSafe returns undefined when reduced motion is preferred', () => {
    setWindowMock(true);

    expect(reducedMotionSafe(fadeSlideUp)).toBeUndefined();
  });

  it('reducedMotionSafe returns variants when motion is allowed', () => {
    setWindowMock(false);

    expect(reducedMotionSafe(fadeSlideUp)).toBe(fadeSlideUp);
  });

  it('safeMotion returns an empty object when reduced motion is preferred', () => {
    setWindowMock(true);

    expect(safeMotion(fadeSlideUp)).toEqual({});
  });

  it('safeMotion returns variant when motion is allowed', () => {
    setWindowMock(false);

    expect(safeMotion(fadeSlideUp)).toBe(fadeSlideUp);
  });
});
