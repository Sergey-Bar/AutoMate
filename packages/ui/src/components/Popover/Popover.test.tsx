import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Popover, PopoverTrigger, PopoverContent } from './Popover.js';

describe('Popover', () => {
  it('renders trigger', () => {
    render(
      <Popover>
        <PopoverTrigger data-testid="trigger">Open</PopoverTrigger>
        <PopoverContent data-testid="content">Content</PopoverContent>
      </Popover>,
    );
    expect(screen.getByTestId('trigger')).toBeInTheDocument();
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  it('opens content on click', () => {
    render(
      <Popover>
        <PopoverTrigger data-testid="trigger">Open</PopoverTrigger>
        <PopoverContent data-testid="content">Content</PopoverContent>
      </Popover>,
    );

    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });
});

describe('Popover keyboard and focus management', () => {
  it('tells assistive technology the trigger opens something, and what', () => {
    render(
      <Popover>
        <PopoverTrigger data-testid="trigger">Open</PopoverTrigger>
        <PopoverContent data-testid="content">Content</PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByTestId('trigger');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // `aria-controls` must name the panel that actually appears.
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger.getAttribute('aria-controls')).toBe(screen.getByTestId('content').id);
  });

  it('opens with Enter', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Content</PopoverContent>
      </Popover>,
    );

    screen.getByRole('button', { name: 'Open' }).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('opens with Space', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Content</PopoverContent>
      </Popover>,
    );

    screen.getByRole('button', { name: 'Open' }).focus();
    await user.keyboard(' ');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('moves focus into the panel so the revealed content is not skipped', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>
          <button type="button" data-testid="apply">
            Apply
          </button>
        </PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    // Focus lands on the panel itself, not on the first control inside it: a
    // popover whose content is a single link or a short form should be read
    // before it is tabbed through.
    expect(screen.getByRole('dialog')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('apply')).toHaveFocus();
  });

  it('dismisses on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Content</PopoverContent>
      </Popover>,
    );

    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('returns focus to the trigger on Escape dismissal', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Content</PopoverContent>
      </Popover>,
    );

    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await user.keyboard('{Escape}');

    // Without this the user is dropped at the top of the document and has no
    // indication that the popover they were reading has gone.
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('reports the close through the trigger onClick without swallowing it', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger onClick={onClick}>Open</PopoverTrigger>
        <PopoverContent>Content</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps a caller-supplied accessible name on the panel', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent aria-label="Run filters">Content</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    // The default name must not overwrite a name the caller chose, or every
    // popover on the page is announced identically.
    expect(screen.getByRole('dialog', { name: 'Run filters' })).toBeInTheDocument();
  });
});
