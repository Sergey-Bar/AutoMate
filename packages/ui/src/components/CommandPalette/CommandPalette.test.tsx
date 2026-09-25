import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
