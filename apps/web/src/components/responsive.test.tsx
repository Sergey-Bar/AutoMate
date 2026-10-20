/// <reference types="vitest/globals" />
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FITTED_QUERY, KIND_ICONS, KindIcon, Responsive, useMediaQuery } from './responsive';

/** A `matchMedia` whose answer the test flips, firing `change` the way a resize would. */
function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    listeners,
    set(next: boolean) {
      matches = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

const PANELS = [
  { id: 'trend', label: 'Trend', node: <p>trend body</p> },
  { id: 'reports', label: 'Reports', node: <p>reports body</p> },
];

describe('Responsive', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the desktop grid without matchMedia, which is what a test environment has', () => {
    render(<Responsive desktop={<p>grid</p>} panels={PANELS} label="Sections" />);
    expect(screen.getByText('grid')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Sections' })).not.toBeInTheDocument();
  });

  it('turns the panels into tabs below the fitted width, one at a time', () => {
    const media = stubMatchMedia(false);
    render(<Responsive desktop={<p>grid</p>} panels={PANELS} label="Sections" />);
    expect(media.matchMedia).toHaveBeenCalledWith(FITTED_QUERY);
    expect(screen.queryByText('grid')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByTestId('responsive-panel')).toHaveTextContent('trend body');
    expect(screen.getByRole('button', { name: 'Trend' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(screen.getByTestId('responsive-panel')).toHaveTextContent('reports body');
    expect(screen.queryByText('trend body')).not.toBeInTheDocument();
  });

  it('keeps the chosen tab across a resize to wide and back', () => {
    const media = stubMatchMedia(false);
    render(<Responsive desktop={<p>grid</p>} panels={PANELS} label="Sections" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    media.set(true);
    expect(screen.getByText('grid')).toBeInTheDocument();
    media.set(false);
    expect(screen.getByTestId('responsive-panel')).toHaveTextContent('reports body');
  });

  it('falls back to the first panel when the chosen one disappears', () => {
    stubMatchMedia(false);
    const { rerender } = render(
      <Responsive desktop={<p>grid</p>} panels={PANELS} label="Sections" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    rerender(<Responsive desktop={<p>grid</p>} panels={PANELS.slice(0, 1)} label="Sections" />);
    expect(screen.getByTestId('responsive-panel')).toHaveTextContent('trend body');
  });

  it('stops listening when it unmounts', () => {
    const media = stubMatchMedia(true);
    function Probe() {
      return <span>{useMediaQuery('(min-width: 1px)') ? 'wide' : 'narrow'}</span>;
    }
    const { unmount } = render(<Probe />);
    expect(screen.getByText('wide')).toBeInTheDocument();
    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});

describe('KindIcon', () => {
  it('draws one decorative glyph per kind of tool', () => {
    const { container } = render(<KindIcon kind="secrets" size={20} className="probe" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveClass('probe');
    // Every kind has its own glyph, so two kinds never read as the same tool.
    expect(new Set(Object.values(KIND_ICONS)).size).toBe(Object.keys(KIND_ICONS).length);
  });
});
