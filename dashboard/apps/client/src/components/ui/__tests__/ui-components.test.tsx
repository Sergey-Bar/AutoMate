import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '../../../test/test-utils';
import userEvent from '@testing-library/user-event';
import { Button } from '../Button';
import { Input } from '../Input';
import { Kbd } from '../Kbd';
import { Select } from '../Select';
import { Toggle } from '../Toggle';
import { Tooltip } from '../Tooltip';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target: unknown, prop: string) => {
      return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, layout: _layout, layoutId: _layoutId, ...rest }: Record<string, unknown>) => {
        const Tag = typeof prop === 'string' && ['div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4'].includes(prop) ? prop : 'div';
        return React.createElement(Tag, rest);
      };
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
  useTransform: (_v: unknown, _input: unknown, output: number[]) => ({ get: () => output?.[0] ?? 0 }),
  useSpring: (v: unknown) => v,
}));

describe('ui components', () => {
  describe('Button', () => {
    it('renders children and handles clicks when enabled', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      render(<Button onClick={onClick}>Run</Button>);
      await user.click(screen.getByRole('button', { name: 'Run' }));

      expect(onClick).toHaveBeenCalledTimes(1);
      const button = screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement;
      expect(button.className).toContain('bg-running');
    });

    it('disables interactions while loading and shows spinner icon', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      render(<Button loading onClick={onClick}>Saving</Button>);
      const button = screen.getByRole('button', { name: 'Saving' }) as HTMLButtonElement;
      await user.click(button);

      expect(button.disabled).toBe(true);
      expect(onClick).not.toHaveBeenCalled();
      expect(button.querySelector('.animate-spin')).not.toBeNull();
    });

    it('renders leading and trailing icons when provided', () => {
      render(
        <Button icon={<span data-testid="left">L</span>} iconRight={<span data-testid="right">R</span>}>
          Go
        </Button>,
      );

      expect(screen.queryByTestId('left')).not.toBeNull();
      expect(screen.queryByTestId('right')).not.toBeNull();
    });
  });

  describe('Input', () => {
    it('connects label and input id automatically', () => {
      render(<Input label="Search Tests" placeholder="query" />);

      const input = screen.getByLabelText('Search Tests');
      expect(input.getAttribute('id')).toBe('search-tests');
      expect(screen.queryByPlaceholderText('query')).not.toBeNull();
    });

    it('renders error message and hides hint when error exists', () => {
      render(<Input label="Name" error="Name is required" hint="Add a name" />);

      expect(screen.queryByText('Name is required')).not.toBeNull();
      expect(screen.queryByText('Add a name')).toBeNull();
    });

    it('renders icon and emits value changes', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Input aria-label="filter" icon={<span data-testid="search-icon">S</span>} onChange={onChange} />);
      const input = screen.getByLabelText('filter');

      await user.type(input, 'abc');

      expect(screen.queryByTestId('search-icon')).not.toBeNull();
      expect(input.className.includes('pl-8')).toBe(true);
      expect(onChange).toHaveBeenCalled();
      expect((input as HTMLInputElement).value).toBe('abc');
    });
  });

  describe('Kbd', () => {
    it('renders a single keycap from children', () => {
      render(<Kbd>Esc</Kbd>);

      expect(screen.getByText('Esc').tagName.toLowerCase()).toBe('kbd');
    });

    it('renders key combinations with plus separators', () => {
      render(<Kbd keys={['Ctrl', 'K', 'P']} />);

      expect(screen.queryByText('Ctrl')).not.toBeNull();
      expect(screen.queryByText('K')).not.toBeNull();
      expect(screen.queryByText('P')).not.toBeNull();
      expect(screen.getAllByText('+')).toHaveLength(2);
    });

    it('renders one keycap per provided key', () => {
      render(<Kbd keys={['G', 'R']} />);

      const keycaps = screen.getAllByText(/G|R/).map((el) => el.closest('kbd')).filter(Boolean);
      expect(keycaps).toHaveLength(2);
    });
  });

  describe('Select', () => {
    const options = [
      { value: 'all', label: 'All' },
      { value: 'failed', label: 'Failed' },
    ];

    it('renders label, placeholder, and options', () => {
      render(<Select label="Status" options={options} placeholder="Choose status" defaultValue="" />);

      const select = screen.getByLabelText('Status');
      expect(select.getAttribute('id')).toBe('status');
      const placeholder = screen.getByRole('option', { name: 'Choose status' }) as HTMLOptionElement;
      expect(placeholder.disabled).toBe(true);
      const failed = screen.getByRole('option', { name: 'Failed' }) as HTMLOptionElement;
      expect(failed.value).toBe('failed');
    });

    it('shows error and suppresses hint', () => {
      render(<Select label="Status" options={options} error="Pick one" hint="Select a status" />);

      expect(screen.queryByText('Pick one')).not.toBeNull();
      expect(screen.queryByText('Select a status')).toBeNull();
    });

    it('updates selected value on change', () => {
      const onChange = vi.fn();
      render(<Select aria-label="status-filter" options={options} defaultValue="all" onChange={onChange} />);

      fireEvent.change(screen.getByLabelText('status-filter'), { target: { value: 'failed' } });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect((screen.getByLabelText('status-filter') as HTMLSelectElement).value).toBe('failed');
    });
  });

  describe('Toggle', () => {
    it('renders as a switch with the provided label', () => {
      render(<Toggle checked={false} onChange={vi.fn()} label="Auto refresh" />);

      const toggle = screen.getByRole('switch');
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      expect(screen.queryByText('Auto refresh')).not.toBeNull();
    });

    it('toggles value on click', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Toggle checked={false} onChange={onChange} />);

      await user.click(screen.getByRole('switch'));

      expect(onChange).toHaveBeenCalledWith(true);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('supports keyboard activation and respects disabled state', () => {
      const onChange = vi.fn();
      render(<Toggle checked={true} onChange={onChange} disabled />);

      const toggle = screen.getByRole('switch');
      fireEvent.keyDown(toggle, { key: 'Enter' });
      fireEvent.keyDown(toggle, { key: ' ' });

      expect((toggle as HTMLButtonElement).disabled).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Tooltip', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows tooltip after hover delay', () => {
      render(
        <Tooltip content="Run details" delay={250}>
          <button type="button">Trigger</button>
        </Tooltip>,
      );

      const wrapper = screen.getByRole('button', { name: 'Trigger' }).parentElement as HTMLElement;
      fireEvent.mouseEnter(wrapper);
      expect(screen.queryByRole('tooltip')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByRole('tooltip').textContent).toContain('Run details');
    });

    it('hides tooltip when pointer leaves', () => {
      render(
        <Tooltip content="Info" delay={100}>
          <button type="button">Target</button>
        </Tooltip>,
      );

      const wrapper = screen.getByRole('button', { name: 'Target' }).parentElement as HTMLElement;
      fireEvent.mouseEnter(wrapper);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByRole('tooltip')).not.toBeNull();

      fireEvent.mouseLeave(wrapper);
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('supports keyboard focus/blur behavior', () => {
      render(
        <Tooltip content="Keyboard tip" delay={50}>
          <button type="button">Focusable</button>
        </Tooltip>,
      );

      const wrapper = screen.getByRole('button', { name: 'Focusable' }).parentElement as HTMLElement;
      fireEvent.focus(wrapper);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(screen.queryByRole('tooltip')).not.toBeNull();

      fireEvent.blur(wrapper);
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });
});
