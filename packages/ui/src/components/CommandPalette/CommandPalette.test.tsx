import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi, beforeEach } from 'vitest';
import { CommandPalette } from './CommandPalette.js';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

const actions = [
  { id: '1', label: 'Create new project', onSelect: vi.fn() },
  { id: '2', label: 'Settings', onSelect: vi.fn() },
  { id: '3', label: 'Sign out', onSelect: vi.fn() },
];

test('opens on Ctrl+K and fuzzy filters', async () => {
  render(<CommandPalette actions={actions} />);

  expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument();

  // trigger Ctrl+K
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

  const input = screen.getByPlaceholderText('Type a command or search...');
  expect(input).toBeInTheDocument();

  expect(screen.getByText('Create new project')).toBeInTheDocument();

  // fuzzy filter
  fireEvent.change(input, { target: { value: 'set' } });
  expect(screen.getByText('Settings')).toBeInTheDocument();
  expect(screen.queryByText('Create new project')).not.toBeInTheDocument();

  // Escape closes
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument();
  });
});

test('handles arrow keys, enter, and recent items', async () => {
  render(<CommandPalette actions={actions} />);

  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

  const input = screen.getByPlaceholderText('Type a command or search...');

  // Arrow down to "Settings" (index 1)
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  // Enter to select
  fireEvent.keyDown(input, { key: 'Enter' });

  expect(actions[1].onSelect).toHaveBeenCalledTimes(1);

  // Local storage should have "2" as recent
  const recent = JSON.parse(localStorage.getItem('automate-cmd-recent') || '[]');
  expect(recent).toEqual(['2']);
});

describe('CommandPalette as a combobox', () => {
  it('exposes the input as a combbox controlling a listbox', async () => {
    const user = userEvent.setup();
    render(<CommandPalette actions={actions} />);

    await user.keyboard('{Control>}k{/Control}');

    const input = await screen.findByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    const listbox = screen.getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(listbox).toBeInTheDocument();
  });

  it('names the option Enter will run, and moves that name with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<CommandPalette actions={actions} />);

    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox');
    // Focus never leaves the input, so `aria-activedescendant` is the only thing
    // that can tell a screen-reader user which option is about to run. Without
    // it the arrow keys move an invisible highlight.
    const firstActive = input.getAttribute('aria-activedescendant');
    expect(firstActive).toBeTruthy();
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('id', firstActive);

    await user.keyboard('{ArrowDown}');

    const secondActive = input.getAttribute('aria-activedescendant');
    expect(secondActive).not.toBe(firstActive);
    expect(screen.getByRole('option', { selected: true }).id).toBe(secondActive);
    expect(screen.getAllByRole('option')).toHaveLength(actions.length);
  });

  it('runs the active option with Enter', async () => {
    const user = userEvent.setup();
    render(<CommandPalette actions={actions} />);

    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('combobox');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(actions[1]?.onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps DOM focus in the input, so Tab cannot escape the overlay', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button" data-testid="page-control">
          Behind the overlay
        </button>
        <CommandPalette actions={actions} />
      </>,
    );

    await user.click(screen.getByTestId('page-control'));
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox');
    expect(input).toHaveFocus();

    await user.tab();
    // The panel is a full-screen overlay; letting Tab reach the page behind it
    // strands the user in content they cannot see.
    expect(screen.getByTestId('page-control')).not.toHaveFocus();
    expect(input).toHaveFocus();
  });

  it('dismisses on Escape and returns focus to where the user was', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button" data-testid="page-control">
          Open the palette from here
        </button>
        <CommandPalette actions={actions} />
      </>,
    );

    const trigger = screen.getByTestId('page-control');
    await user.click(trigger);
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('combobox');
    expect(trigger).not.toHaveFocus();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
    // Without this the palette closes and the user is dropped at the top of the
    // document with no idea why.
    expect(trigger).toHaveFocus();
  });

  it('labels the panel it opens as a named dialog', async () => {
    const user = userEvent.setup();
    render(<CommandPalette actions={actions} />);

    await user.keyboard('{Control>}k{/Control}');

    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });
});
