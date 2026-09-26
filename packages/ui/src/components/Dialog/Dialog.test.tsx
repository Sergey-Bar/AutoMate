import { render, screen } from '@testing-library/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './Dialog.js';

describe('Dialog', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function mock(this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function mock(this: HTMLDialogElement) {
      this.open = false;
    });
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
