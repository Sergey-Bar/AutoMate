/// <reference types="vitest/globals" />
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { useFitCount } from './kit';
import { useTileCount } from '../routes/dashboard/toolbox';

/**
 * The two fitting hooks, against a box whose size the test sets.
 *
 * jsdom lays nothing out, so `clientWidth`/`clientHeight` are written onto the element and
 * a stub `ResizeObserver` is told when they change — which is exactly the contract the
 * hooks rely on in a browser.
 */
let observers: Array<{ callback: () => void; disconnected: boolean }> = [];

class StubResizeObserver {
  entry: { callback: () => void; disconnected: boolean };
  constructor(callback: () => void) {
    this.entry = { callback, disconnected: false };
    observers.push(this.entry);
  }
  observe(): void {}
  disconnect(): void {
    this.entry.disconnected = true;
  }
}

function size(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
}

function resize(): void {
  act(() => observers.forEach((entry) => entry.disconnected || entry.callback()));
}

function Rows({ offset = 0 }: { offset?: number }) {
  const [count, ref] = useFitCount(50, 7, offset);
  return (
    <div data-testid="box" ref={ref}>
      {count}
    </div>
  );
}

function Tiles() {
  const [count, ref] = useTileCount(24);
  return (
    <div data-testid="box" ref={ref}>
      {count}
    </div>
  );
}

/** Sizes the box before the hook's effect reads it, the way a laid-out page would. */
function sizedRender(node: React.ReactElement, width: number, height: number) {
  const result = render(node);
  size(screen.getByTestId('box'), width, height);
  resize();
  return result;
}

describe('fitting a list to its box', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('counts the rows that fit, less the part of the box that is not rows', () => {
    sizedRender(<Rows offset={40} />, 300, 340);
    expect(screen.getByTestId('box')).toHaveTextContent('6');
    size(screen.getByTestId('box'), 300, 140);
    resize();
    expect(screen.getByTestId('box')).toHaveTextContent('2');
  });

  it('keeps at least one row, and falls back while the box has no height', () => {
    sizedRender(<Rows />, 300, 20);
    expect(screen.getByTestId('box')).toHaveTextContent('1');
    size(screen.getByTestId('box'), 300, 0);
    resize();
    expect(screen.getByTestId('box')).toHaveTextContent('7');
  });

  it('stops observing when it unmounts', () => {
    const { unmount } = sizedRender(<Rows />, 300, 200);
    unmount();
    expect(observers.every((entry) => entry.disconnected)).toBe(true);
  });

  it('answers the fallback without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Rows />);
    expect(screen.getByTestId('box')).toHaveTextContent('7');
  });
});

describe('fitting a tile grid to its box', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('multiplies the columns its width holds by the rows its height holds', () => {
    // 6.5rem tiles with a 0.75rem gap: 648px is five columns, 360px is three rows.
    sizedRender(<Tiles />, 648, 360);
    expect(screen.getByTestId('box')).toHaveTextContent('15');
    // A phone: three columns, five rows.
    size(screen.getByTestId('box'), 358, 610);
    resize();
    expect(screen.getByTestId('box')).toHaveTextContent('15');
  });

  it('falls back while the box is too small for a single tile', () => {
    sizedRender(<Tiles />, 100, 600);
    expect(screen.getByTestId('box')).toHaveTextContent('24');
  });
});
