import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  Dialog,
  DialogClose,
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

  it('moves focus to the title on open, so no action is armed before it is read', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByTestId('open'));

    // Not the first button: in the toolbox that was Copy, and in the runner it was Run.
    expect(screen.getByRole('heading', { name: 'Cancel run' })).toHaveFocus();
  });

  it('keeps Tab inside the dialog, wrapping from the last control to the first', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByTestId('open'));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('confirm')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('cancel')).toHaveFocus();

    // The next control in the document is *outside* the dialog. Without the trap
    // this is where focus lands, and the user is silently returned to the page
    // behind a modal they never dismissed.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('keeps Shift+Tab inside the dialog, wrapping backwards from the first control', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByTestId('open'));
    // From the title, which is not itself a Tab stop, backwards is the last control.
    await user.tab({ shift: true });
    expect(screen.getByTestId('cancel')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByTestId('cancel')).toHaveFocus();
  });

  it('restores focus to the trigger that opened it', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByTestId('open');
    await user.click(trigger);
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

/**
 * The defect: a dialog with no close control and no backdrop dismissal could only be left
 * with Escape. On a phone, or for anyone using a mouse, the toolbox's tool dialog was a trap.
 */
describe('Dialog can always be dismissed', () => {
  beforeEach(() => {
    stubDialogElement();
  });

  it('closes from the visible close button and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByTestId('open');
    await user.click(trigger);
    expect(screen.getByTestId('dialog')).toHaveAttribute('open');

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByTestId('dialog')).not.toHaveAttribute('open');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes on a click on the backdrop, and not on a click inside the content', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByTestId('open'));

    await user.click(screen.getByText('This cannot be undone.'));
    expect(screen.getByTestId('dialog')).toHaveAttribute('open');

    // A click whose target is the <dialog> itself landed outside the content box, which is
    // where the backdrop is drawn.
    await user.click(screen.getByTestId('dialog'));
    expect(screen.getByTestId('dialog')).not.toHaveAttribute('open');
  });

  it('does not close when a press starts in the content and is released on the backdrop', () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByTestId('open'));
    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveAttribute('open');
    fireEvent.pointerDown(screen.getByText('This cannot be undone.'));
    fireEvent.click(dialog);
    expect(dialog).toHaveAttribute('open');
  });

  it('honours data-autofocus over the title', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogHeader>
              <DialogTitle>Quarantine a test</DialogTitle>
            </DialogHeader>
            <input aria-label="Test title" data-autofocus />
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('textbox', { name: 'Test title' })).toHaveFocus();
  });

  it('omits the close button when asked, and names it when told to', () => {
    const { rerender } = render(
      <Dialog open>
        <DialogHeader showClose={false}>
          <DialogTitle>Title</DialogTitle>
        </DialogHeader>
      </Dialog>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    rerender(
      <Dialog open>
        <DialogHeader closeLabel="Close the tool">
          <DialogTitle>Title</DialogTitle>
        </DialogHeader>
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Close the tool' })).toBeInTheDocument();
  });

  it('a standalone DialogClose outside any Dialog renders nothing', () => {
    const { container } = render(<DialogClose />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Dialog with content that brings its own heading', () => {
  beforeEach(() => {
    stubDialogElement();
  });

  it('focuses that heading rather than the close button, without making it a Tab stop', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Launch
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogClose />
            <form>
              <h2>Launch browser run</h2>
              <button type="submit">Queue</button>
            </form>
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Launch' }));
    const heading = screen.getByRole('heading', { name: 'Launch browser run' });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('falls back to the first control, then to the dialog itself', () => {
    const { rerender } = render(
      <Dialog open data-testid="dialog">
        <button type="button">Only control</button>
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Only control' })).toHaveFocus();
    rerender(<Dialog data-testid="dialog">text</Dialog>);
    rerender(
      <Dialog open data-testid="dialog">
        text
      </Dialog>,
    );
    expect(screen.getByTestId('dialog')).toHaveFocus();
  });
});
