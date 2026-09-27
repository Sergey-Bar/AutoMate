import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './Dialog.js';

/**
 * jsdom has no `<dialog>` implementation. `showModal` is missing entirely and
 * `close` never fires the `close` event the component listens to for focus
 * restore, so the stubs below supply both — otherwise the focus-management tests
 * would assert behaviour jsdom silently declined to run.
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

describe('Dialog', () => {
  beforeEach(() => {
    stubDialogElement();
  });

  it('renders dialog closed by default', () => {
    render(<Dialog data-testid="dialog">Content</Dialog>);
    const dialog = screen.getByTestId('dialog');
    expect(dialog).not.toBeVisible(); // JS dom won't hide it visually but it's not open
    expect(dialog).not.toHaveAttribute('open');
  });

  it('renders dialog open when prop is true', () => {
    render(
      <Dialog data-testid="dialog" open>
        Content
      </Dialog>,
    );
    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveAttribute('open');
  });

  it('renders dialog subcomponents', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Description</DialogDescription>
          </DialogHeader>
          <DialogFooter>Footer</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });
});

/** A trigger that opens a Dialog the way the real app does. */
function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="open" onClick={() => setOpen(true)}>
        Cancel run
      </button>
      <button type="button" data-testid="after">
        Next control on the page
      </button>
      <Dialog open={open} onOpenChange={setOpen} data-testid="dialog">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel run</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" data-testid="confirm">
              Confirm
            </button>
            <button type="button" data-testid="cancel" onClick={() => setOpen(false)}>
              Keep it
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('Dialog keyboard and focus management', () => {
  beforeEach(() => {
    stubDialogElement();
  });

  it('moves focus into the dialog on open, so the content is not skipped', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByTestId('open'));

    expect(screen.getByTestId('confirm')).toHaveFocus();
  });

  it('keeps Tab inside the dialog, wrapping from the last control to the first', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByTestId('open'));
    expect(screen.getByTestId('confirm')).toHaveFocus();

    await user.tab();
    expect(screen.getByTestId('cancel')).toHaveFocus();

    // The next control in the document is *outside* the dialog. Without the trap
    // this is where focus lands, and the user is silently returned to the page
    // behind a modal they never dismissed.
    await user.tab();
    expect(screen.getByTestId('confirm')).toHaveFocus();
  });

  it('keeps Shift+Tab inside the dialog, wrapping backwards from the first control', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByTestId('open'));
    expect(screen.getByTestId('confirm')).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByTestId('cancel')).toHaveFocus();
  });

  it('restores focus to the trigger that opened it', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByTestId('open');
    await user.click(trigger);
    expect(screen.getByTestId('confirm')).toHaveFocus();

    await user.click(screen.getByTestId('cancel'));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('activates a control with Enter and with Space', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open>
        <button type="button" data-testid="confirm" onClick={onConfirm}>
          Confirm
        </button>
      </Dialog>,
    );

    screen.getByTestId('confirm').focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('keeps aria-modal even when a spread on the element would override it', () => {
    // The regression: `aria-modal` used to sit *before* `{...props}`, so a caller
    // spreading an object containing `aria-modal` turned a modal dialog into a
    // non-modal one without any error anywhere.
    render(
      <Dialog open data-testid="dialog" {...{ 'aria-modal': 'false' }}>
        Content
      </Dialog>,
    );
    expect(screen.getByTestId('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});
