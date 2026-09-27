import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs.js';

test('renders tabs and handles clicking', () => {
  const onValueChange = vi.fn();
  render(
    <Tabs value="tab1" onValueChange={onValueChange}>
      <TabsList>
        <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab2">Tab 2</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">Content 1</TabsContent>
      <TabsContent value="tab2">Content 2</TabsContent>
    </Tabs>,
  );

  expect(screen.getByText('Content 1')).toBeInTheDocument();
  expect(screen.queryByText('Content 2')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('Tab 2'));
  expect(onValueChange).toHaveBeenCalledWith('tab2');
});

test('handles keyboard navigation', () => {
  const onValueChange = vi.fn();
  render(
    <Tabs value="tab1" onValueChange={onValueChange}>
      <TabsList>
        <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        <TabsTrigger value="tab3">Tab 3</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">Content 1</TabsContent>
      <TabsContent value="tab2">Content 2</TabsContent>
      <TabsContent value="tab3">Content 3</TabsContent>
    </Tabs>,
  );

  const tab1 = screen.getByText('Tab 1');
  tab1.focus();

  fireEvent.keyDown(tab1, { key: 'ArrowRight' });
  expect(onValueChange).toHaveBeenCalledWith('tab2');

  fireEvent.keyDown(tab1, { key: 'ArrowLeft' });
  expect(onValueChange).toHaveBeenCalledWith('tab3'); // wrap around
});

/** A controlled tab set, so selection follows the keyboard the way it must. */
function TabsHarness() {
  const [value, setValue] = useState('runs');
  return (
    <div>
      <button type="button" data-testid="before">
        Before the tablist
      </button>
      <Tabs value={value} onValueChange={setValue}>
        <TabsList aria-label="Run views">
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="quarantine">Quarantine</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="runs">Runs panel</TabsContent>
        <TabsContent value="quarantine">Quarantine panel</TabsContent>
        <TabsContent value="analytics">Analytics panel</TabsContent>
      </Tabs>
    </div>
  );
}

describe('Tabs keyboard and focus', () => {
  it('puts the whole tablist behind one tab stop, on the selected tab', async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);

    await user.tab();
    expect(screen.getByTestId('before')).toHaveFocus();

    // The ARIA tabs pattern is a single tab stop with arrow-key movement inside
    // it. One stop per tab would make a three-tab bar three stops in the page's
    // tab order.
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Runs' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Runs' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Quarantine' })).toHaveAttribute('tabindex', '-1');

    // The next stop is the panel, not the second tab.
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('moves focus and selection together with the arrow keys, wrapping around', async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);

    screen.getByRole('tab', { name: 'Runs' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Quarantine' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Quarantine' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Quarantine panel')).toBeInTheDocument();

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Runs' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Analytics' })).toHaveFocus();
  });

  it('selects a tab with Enter and with Space', async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);

    screen.getByRole('tab', { name: 'Quarantine' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Quarantine panel')).toBeInTheDocument();

    screen.getByRole('tab', { name: 'Analytics' }).focus();
    await user.keyboard(' ');
    expect(screen.getByText('Analytics panel')).toBeInTheDocument();
  });

  it('ties the panel to its tab so the name is announced', () => {
    render(
      <Tabs value="runs" onValueChange={vi.fn()}>
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>
        <TabsContent value="runs">Runs panel</TabsContent>
      </Tabs>,
    );
    const tab = screen.getByRole('tab', { name: 'Runs' });
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(tab).toHaveAttribute('aria-controls', panel.id);
  });
});
