import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from './Drawer.js';

/**
 * jsdom implements no part of the modal dialog behaviour: `showModal` is absent
 * and `close` never fires the `close` event the component listens to in order to
 * restore focus. The stubs supply both, or the focus tests below would be
 * asserting something jsdom declined to do.
 */
function stubDialogElement(): void {
  HTMLDialogElement.prototype.showModal = vi.fn(function mock(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function mock(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  });
}

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    render(
      <Drawer open={false}>
        <DrawerContent data-testid="drawer">Content</DrawerContent>
      </Drawer>,
    );
    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  // JSDOM does not fully support HTMLDialogElement, so showModal might throw or not work perfectly.
  // We'll test basic rendering for DrawerContent directly.
  it('renders content correctly', () => {
    render(
      <DrawerContent data-testid="drawer-content">
        <DrawerHeader>
          <DrawerTitle>Title</DrawerTitle>
        </DrawerHeader>
        Content
      </DrawerContent>,
    );
    expect(screen.getByTestId('drawer-content')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('applies position variants', () => {
    render(<Drawer data-testid="drawer-root" position="right" open />);
    expect(screen.getByTestId('drawer-root')).toHaveClass('right-0');
  });
});

/** A trigger that opens a Drawer the way the real app does. */
function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="open" onClick={() => setOpen(true)}>
        Open filters
      </button>
      <button type="button" data-testid="after">
        Next control on the page
      </button>
      <Drawer open={open} onOpenChange={setOpen} data-testid="drawer">
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Filters</DrawerTitle>
          </DrawerHeader>
          <button type="button" data-testid="apply">
            Apply
          </button>
          <button type="button" data-testid="close" onClick={() => setOpen(false)}>
            Close
          </button>
        </DrawerContent>
      </Drawer>
    </>
  );
}

describe('Drawer keyboard and focus management', () => {
  beforeEach(() => {
    stubDialogElement();
  });

  it('moves focus into the drawer on open', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);

    await user.click(screen.getByTestId('open'));

    expect(screen.getByTestId('apply')).toHaveFocus();
  });

  it('keeps Tab inside the drawer instead of letting it reach the page behind', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);

    await user.click(screen.getByTestId('open'));
    await user.tab();
    expect(screen.getByTestId('close')).toHaveFocus();

    // Wraps back to the first control rather than escaping to `after`, which is
    // behind a surface the user never dismissed.
    await user.tab();
    expect(screen.getByTestId('apply')).toHaveFocus();
  });

  it('keeps Shift+Tab inside the drawer, wrapping backwards from the first control', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);

    await user.click(screen.getByTestId('open'));
    expect(screen.getByTestId('apply')).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByTestId('close')).toHaveFocus();
  });

  it('restores focus to the trigger that opened it', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);

    const trigger = screen.getByTestId('open');
    await user.click(trigger);
    expect(screen.getByTestId('apply')).toHaveFocus();

    await user.click(screen.getByTestId('close'));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps aria-modal even when a spread on the element would override it', () => {
    render(
      <Drawer open data-testid="drawer-root" {...{ 'aria-modal': 'false' }}>
        Content
      </Drawer>,
    );
    expect(screen.getByTestId('drawer-root')).toHaveAttribute('aria-modal', 'true');
  });
});
