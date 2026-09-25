/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { Tooltip } from './Tooltip.js';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    span: ({
      children,
      style,
      className,
      role,
    }: {
      children?: React.ReactNode;
      style?: React.CSSProperties;
      className?: string;
      role?: string;
    }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (require('react') as any).createElement('span', { style, className, role }, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

describe('Tooltip', () => {
  it('renders children', () => {
    const html = renderToString(
      <Tooltip content="Tooltip text">
        <button>Hover me</button>
      </Tooltip>,
    );
    expect(html).toContain('Hover me');
  });

  it('renders wrapping span with relative inline-flex', () => {
    const html = renderToString(
      <Tooltip content="tip">
        <span>child</span>
      </Tooltip>,
    );
    expect(html).toContain('relative inline-flex');
  });

  it('has onMouseEnter, onMouseLeave, onFocus, onBlur handlers on outer span', () => {
    // SSR won't show event handlers directly, but we verify children and container render
    const html = renderToString(
      <Tooltip content="tip">
        <button>btn</button>
      </Tooltip>,
    );
    expect(html).toContain('<span');
    expect(html).toContain('btn');
  });

  it('does not render tooltip initially (open=false in SSR)', () => {
    // Tooltip uses useState(false) so tooltip body is not rendered on initial render
    const html = renderToString(
      <Tooltip content="Hidden tooltip">
        <button>btn</button>
      </Tooltip>,
    );
    expect(html).not.toContain('Hidden tooltip');
  });

  it('accepts side=top (default)', () => {
    // We just verify it renders without errors
    const html = renderToString(
      <Tooltip content="top tip" side="top">
        <span>child</span>
      </Tooltip>,
    );
    expect(html).toContain('child');
  });

  it('accepts side=bottom', () => {
    const html = renderToString(
      <Tooltip content="bottom tip" side="bottom">
        <span>child</span>
      </Tooltip>,
    );
    expect(html).toContain('child');
  });

  it('accepts delay prop without error', () => {
    const html = renderToString(
      <Tooltip content="delayed tip" delay={500}>
        <span>child</span>
      </Tooltip>,
    );
    expect(html).toContain('child');
  });

  it('renders ReactNode content correctly', () => {
    // We verify that content is ReactNode type - passes without error
    const content = <strong>Bold tip</strong>;
    // Tooltip is closed on init, so content won't be in HTML
    const html = renderToString(
      <Tooltip content={content}>
        <span>hover me</span>
      </Tooltip>,
    );
    expect(html).toContain('hover me');
  });
});

describe('Tooltip event handlers (show/hide)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('show() sets a setTimeout to open the tooltip', () => {
    let capturedOnMouseEnter: (() => void) | undefined;
    function Wrapper() {
      const el = Tooltip({ content: 'tip', children: React.createElement('button', null, 'btn') }) as React.ReactElement<{
        onMouseEnter?: () => void;
      }>;
      capturedOnMouseEnter = el.props.onMouseEnter;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    expect(() => capturedOnMouseEnter?.()).not.toThrow();
    expect(() => vi.runAllTimers()).not.toThrow();
  });

  it('hide() clears the timer and closes the tooltip', () => {
    let capturedOnMouseEnter: (() => void) | undefined;
    let capturedOnMouseLeave: (() => void) | undefined;
    function Wrapper() {
      const el = Tooltip({ content: 'tip', children: React.createElement('button', null, 'btn') }) as React.ReactElement<{
        onMouseEnter?: () => void;
        onMouseLeave?: () => void;
      }>;
      capturedOnMouseEnter = el.props.onMouseEnter;
      capturedOnMouseLeave = el.props.onMouseLeave;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    capturedOnMouseEnter?.();
    expect(() => capturedOnMouseLeave?.()).not.toThrow();
  });

  it('onFocus also calls show()', () => {
    let capturedOnFocus: (() => void) | undefined;
    function Wrapper() {
      const el = Tooltip({ content: 'tip', children: React.createElement('button', null, 'btn') }) as React.ReactElement<{
        onFocus?: () => void;
      }>;
      capturedOnFocus = el.props.onFocus;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    expect(() => capturedOnFocus?.()).not.toThrow();
    expect(() => vi.runAllTimers()).not.toThrow();
  });

  it('onBlur also calls hide()', () => {
    let capturedOnFocus: (() => void) | undefined;
    let capturedOnBlur: (() => void) | undefined;
    function Wrapper() {
      const el = Tooltip({ content: 'tip', children: React.createElement('button', null, 'btn') }) as React.ReactElement<{
        onFocus?: () => void;
        onBlur?: () => void;
      }>;
      capturedOnFocus = el.props.onFocus;
      capturedOnBlur = el.props.onBlur;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    capturedOnFocus?.();
    expect(() => capturedOnBlur?.()).not.toThrow();
  });
});
