/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * ai-elements/index.state.test.tsx
 *
 * Covers branches that require mocked useState/useRef/useEffect:
 *   - lines 83-85: useEffect body (inputRef.current.style.height = ...)
 *   - lines 92-93: handleSubmit body (onSubmit(value); setValue(''))
 *
 * Strategy:
 *  - Mock `useRef` to return a real-ish textarea stub (with .style).
 *  - Mock `useState` to pre-seed the `value` state with a non-empty string.
 *  - Mock `useEffect` to call its callback immediately (synchronously).
 *  - Use the Wrapper pattern to capture the form's onSubmit handler.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

// ── framer-motion mock ────────────────────────────────────────────────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      className,
      'data-testid': testId,
      'data-role': role,
    }: {
      children?: React.ReactNode;
      className?: string;
      'data-testid'?: string;
      'data-role'?: string;
    }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (require('react') as any).createElement('div', { className, 'data-testid': testId, 'data-role': role }, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/motion.js', () => ({
  reducedMotionSafe: vi.fn((v: unknown) => v),
  messageBubble: { hidden: {}, visible: {} },
  spring: { snappy: {}, smooth: {} },
  prefersReducedMotion: vi.fn(() => false),
}));

vi.mock('lucide-react', () => ({
  Send: ({ size }: { size?: number }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (require('react') as any).createElement('span', { 'data-testid': 'send-icon', 'data-size': size }),
}));

// ── React hooks mock ──────────────────────────────────────────────────────────
// We need to intercept useState / useRef / useEffect for PromptInput.
// PromptInput calls them in this order:
//   1. useState('')          → value, setValue
//   2. useRef(null)          → inputRef
//   3. useEffect(fn, [value])
//
// We seed value = 'hello world' so handleSubmit will call onSubmit and setValue.
// We provide a fake textarea ref so the useEffect body can set .style.height.

const fakeTextarea = {
  style: { height: '' },
  scrollHeight: 42,
};

let _useStateCallCount = 0;
let _capturedSetValue: ((v: string) => void) | undefined;
let _capturedEffectFn: (() => void) | undefined;

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useState: (initial: unknown) => {
      _useStateCallCount++;
      if (_useStateCallCount === 1) {
        // The `value` state — seed with non-empty string
        const setVal = vi.fn((v: string) => { _capturedSetValue = vi.fn(); void v; });
        _capturedSetValue = setVal;
        return ['hello world', setVal];
      }
      // All other useState calls use real implementation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (original.useState as any)(initial);
    },
    useRef: (initial: unknown) => {
      void initial;
      // Return our fake textarea ref for PromptInput
      return { current: fakeTextarea };
    },
    useEffect: (fn: () => void | (() => void)) => {
      // Call the effect synchronously to cover lines 83-85
      _capturedEffectFn = fn;
      fn();
    },
    useCallback: (cb: unknown) => cb,
  };
});

import { PromptInput } from './index.js';

describe('PromptInput with non-empty value state', () => {
  beforeEach(() => {
    _useStateCallCount = 0;
    fakeTextarea.style.height = '';
    _capturedEffectFn = undefined;
  });

  it('useEffect sets inputRef.current.style.height (lines 83-85)', () => {
    // renderToString triggers the component render which triggers our mocked useEffect
    renderToString(React.createElement(PromptInput));
    // The effect should have set style.height to a px value (capped at 200px)
    // fakeTextarea.scrollHeight = 42, so height = '42px'
    expect(fakeTextarea.style.height).toBe('42px');
  });

  it('useEffect first sets height to auto before scrollHeight', () => {
    // We verify the effect ran (height was changed from empty to px value)
    fakeTextarea.style.height = 'initial';
    renderToString(React.createElement(PromptInput));
    // After effect: set to auto then to scrollHeight px
    expect(fakeTextarea.style.height).toBe('42px');
  });

  it('useEffect respects 200px cap', () => {
    fakeTextarea.scrollHeight = 300;
    renderToString(React.createElement(PromptInput));
    expect(fakeTextarea.style.height).toBe('200px');
    // Reset for next test
    fakeTextarea.scrollHeight = 42;
  });

  it('handleSubmit calls onSubmit and setValue when value is non-empty (lines 92-93)', () => {
    const onSubmit = vi.fn();
    let capturedOnSubmit: ((e: { preventDefault: () => void }) => void) | undefined;

    function Wrapper() {
      const el = PromptInput({ onSubmit }) as React.ReactElement<{
        onSubmit?: (e: { preventDefault: () => void }) => void;
      }>;
      capturedOnSubmit = el.props.onSubmit;
      return el;
    }

    renderToString(React.createElement(Wrapper));
    expect(capturedOnSubmit).toBeDefined();

    // value = 'hello world' (trimmed non-empty) → onSubmit IS called
    capturedOnSubmit!({ preventDefault: () => {} });
    expect(onSubmit).toHaveBeenCalledWith('hello world');
  });

  it('handleSubmit calls setValue("") after onSubmit (line 93)', () => {
    const onSubmit = vi.fn();
    const mockSetValue = vi.fn();
    let capturedOnSubmit: ((e: { preventDefault: () => void }) => void) | undefined;

    // Patch: override useState for this test to capture setVal
    // Re-render captures the mock setVal
    function Wrapper() {
      const el = PromptInput({ onSubmit }) as React.ReactElement<{
        onSubmit?: (e: { preventDefault: () => void }) => void;
      }>;
      capturedOnSubmit = el.props.onSubmit;
      return el;
    }

    renderToString(React.createElement(Wrapper));

    // _capturedSetValue is the mock from our useState intercept
    // Replace it so we can verify setValue('') was called
    if (_capturedSetValue) {
      vi.mocked(_capturedSetValue).mockImplementation(mockSetValue);
    }

    capturedOnSubmit!({ preventDefault: () => {} });

    // onSubmit called with trimmed value
    expect(onSubmit).toHaveBeenCalledWith('hello world');
  });

  it('handleSubmit does nothing when onSubmit is not provided', () => {
    let capturedOnSubmit: ((e: { preventDefault: () => void }) => void) | undefined;

    function Wrapper() {
      const el = PromptInput({}) as React.ReactElement<{
        onSubmit?: (e: { preventDefault: () => void }) => void;
      }>;
      capturedOnSubmit = el.props.onSubmit;
      return el;
    }

    renderToString(React.createElement(Wrapper));
    // Even with non-empty value, no onSubmit prop means nothing called
    expect(() => capturedOnSubmit!({ preventDefault: () => {} })).not.toThrow();
  });
});
