import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { Splitter, SPLITTER_STEP } from './Splitter.js';

describe('Splitter', () => {
  it('renders correctly', () => {
    render(<Splitter data-testid="splitter" />);
    expect(screen.getByTestId('splitter')).toBeInTheDocument();
  });

  it('renders horizontally by default', () => {
    render(<Splitter data-testid="splitter" />);
    expect(screen.getByTestId('splitter')).toHaveClass('h-px');
  });

  it('renders vertically when specified', () => {
    render(<Splitter data-testid="splitter" orientation="vertical" />);
    expect(screen.getByTestId('splitter')).toHaveClass('w-px');
  });
});

/** A controlled splitter, the way a pane layout drives it. */
function SplitterHarness(props: { min?: number; max?: number; initial?: number }) {
  const [value, setValue] = useState(props.initial ?? 50);
  return (
    <div>
      <button type="button" data-testid="before">
        Before
      </button>
      <Splitter
        data-testid="splitter"
        value={value}
        min={props.min}
        max={props.max}
        onValueChange={setValue}
      />
      <span data-testid="value">{value}</span>
    </div>
  );
}

describe('Splitter as a keyboard-operable separator', () => {
  it('publishes the range a screen reader needs to announce a separator position', () => {
    render(<Splitter data-testid="splitter" value={40} min={10} max={90} />);
    const splitter = screen.getByTestId('splitter');
    expect(splitter).toHaveAttribute('aria-valuenow', '40');
    expect(splitter).toHaveAttribute('aria-valuemin', '10');
    expect(splitter).toHaveAttribute('aria-valuemax', '90');
  });

  it('clamps a value outside the declared range to that range', () => {
    render(<Splitter data-testid="splitter" value={140} min={10} max={90} />);
    // Announcing 140 when the maximum is 90 is a lie the keyboard handler then
    // acts on inconsistently.
    expect(screen.getByTestId('splitter')).toHaveAttribute('aria-valuenow', '90');
  });

  it('is focusable, so the divider is not mouse-only', async () => {
    const user = userEvent.setup();
    render(<SplitterHarness />);

    await user.tab();
    expect(screen.getByTestId('before')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('splitter')).toHaveFocus();
  });

  it('resizes with ArrowRight and ArrowLeft on a horizontal divider', async () => {
    const user = userEvent.setup();
    render(<SplitterHarness initial={50} />);

    screen.getByTestId('splitter').focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('value')).toHaveTextContent(String(50 + SPLITTER_STEP));

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('value')).toHaveTextContent('50');
  });

  it('resizes with ArrowUp and ArrowDown on a vertical divider, matching its orientation', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Splitter
        data-testid="splitter"
        orientation="vertical"
        value={50}
        onValueChange={onValueChange}
      />,
    );

    screen.getByTestId('splitter').focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowUp}');

    expect(screen.getByTestId('splitter')).toHaveAttribute('aria-orientation', 'vertical');
    expect(onValueChange).toHaveBeenNthCalledWith(1, 50 + SPLITTER_STEP);
    expect(onValueChange).toHaveBeenNthCalledWith(2, 50 - SPLITTER_STEP);
  });

  it('jumps to the bounds with Home and End', async () => {
    const user = userEvent.setup();
    render(<SplitterHarness initial={50} min={20} max={80} />);

    screen.getByTestId('splitter').focus();
    await user.keyboard('{End}');
    expect(screen.getByTestId('value')).toHaveTextContent('80');

    await user.keyboard('{Home}');
    expect(screen.getByTestId('value')).toHaveTextContent('20');
  });

  it('stops at the bounds instead of overshooting', async () => {
    const user = userEvent.setup();
    render(<SplitterHarness initial={80 - SPLITTER_STEP} min={20} max={80} />);

    screen.getByTestId('splitter').focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('value')).toHaveTextContent('80');

    // A separator that reports 85 against a declared maximum of 80 is a control
    // whose own announcement contradicts the state it drives.
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('value')).toHaveTextContent('80');
  });

  it('ignores a key it has no meaning for, and still calls the caller handler', async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    render(
      <Splitter data-testid="splitter" value={50} onValueChange={vi.fn()} onKeyDown={onKeyDown} />,
    );

    screen.getByTestId('splitter').focus();
    await user.keyboard('a');

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
