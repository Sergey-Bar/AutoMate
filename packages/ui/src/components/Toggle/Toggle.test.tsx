import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { Toggle } from './Toggle.js';

describe('Toggle', () => {
  it('renders without errors', () => {
    render(<Toggle data-testid="test-toggle" />);
    expect(screen.getByTestId('test-toggle')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('applies disabled state', () => {
    render(<Toggle disabled data-testid="test-toggle" />);
    const toggle = screen.getByTestId('test-toggle');
    expect(toggle).toBeDisabled();
  });

  it('renders with label', () => {
    render(<Toggle id="test-id" label="Test Label" />);
    const label = screen.getByText('Test Label');
    const toggle = screen.getByRole('switch');
    expect(label).toBeInTheDocument();
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('id', 'test-id');
  });

  it('applies checked state', () => {
    render(<Toggle checked readOnly data-testid="test-toggle" />);
    const toggle = screen.getByTestId('test-toggle');
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});

/** A controlled switch, so a keyboard press has somewhere to go. */
function ToggleHarness() {
  const [checked, setChecked] = useState(false);
  return (
    <div>
      <button type="button" data-testid="before">
        Before
      </button>
      <Toggle
        id="live-updates"
        label="Live updates"
        checked={checked}
        onChange={(event) => setChecked(event.target.checked)}
      />
      <span data-testid="state">{checked ? 'on' : 'off'}</span>
    </div>
  );
}

describe('Toggle keyboard operation', () => {
  it('is reachable by Tab and reports itself as a switch', async () => {
    const user = userEvent.setup();
    render(<ToggleHarness />);

    await user.tab();
    expect(screen.getByTestId('before')).toHaveFocus();
    await user.tab();

    const toggle = screen.getByRole('switch', { name: 'Live updates' });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('flips with Space, which is how a checkbox is operated by keyboard', async () => {
    const user = userEvent.setup();
    render(<ToggleHarness />);

    screen.getByRole('switch').focus();
    await user.keyboard(' ');

    expect(screen.getByTestId('state')).toHaveTextContent('on');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('is named by its label rather than being an unnamed switch', () => {
    render(<ToggleHarness />);
    // A switch with no accessible name is announced as "switch, unchecked", and
    // the user cannot tell what it controls.
    expect(screen.getByRole('switch', { name: 'Live updates' })).toBeInTheDocument();
  });

  it('does not flip when it is disabled', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Toggle id="live" label="Live updates" disabled onChange={vi.fn()} />
        <span data-testid="state">off</span>
      </div>,
    );

    screen.getByRole('switch').focus();
    await user.keyboard(' ');

    expect(screen.getByTestId('state')).toHaveTextContent('off');
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
