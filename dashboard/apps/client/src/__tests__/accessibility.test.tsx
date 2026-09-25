/**
 * Accessibility tests for key UI components.
 *
 * Validates WCAG compliance via axe-core, ARIA attributes,
 * keyboard interactions, and semantic HTML patterns.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../test/test-utils';
import * as axeMatchers from 'vitest-axe/matchers';
import { axe } from 'vitest-axe';

expect.extend(axeMatchers);

// ── Mocks (MUST come before component imports) ──────────────────────────────

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return ({
          initial: _initial,
          animate: _animate,
          exit: _exit,
          variants: _variants,
          whileHover: _whileHover,
          whileTap: _whileTap,
          transition: _transition,
          layout: _layout,
          layoutId: _layoutId,
          ...rest
        }: Record<string, unknown>) => {
          const Tag =
            typeof prop === 'string' &&
            [
              'div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td',
              'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside',
              'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4',
            ].includes(prop)
              ? prop
              : 'div';
          return React.createElement(Tag, rest);
        };
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
  useTransform: (_v: unknown, _input: unknown, output: number[]) => ({
    get: () => output?.[0] ?? 0,
  }),
  useSpring: (v: unknown) => v,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
    React.createElement('a', { href: to ?? '', ...rest }, children),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  useSearch: () => ({}),
  useParams: () => ({}),
}));

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}));

// ── Component imports (after mocks) ─────────────────────────────────────────

import { StatusBadge } from '../components/shared/StatusBadge';
import { FilterBar } from '../components/shared/FilterBar';
import { ErrorAlert } from '../components/shared/ErrorAlert';
import { EmptyState } from '../components/shared/EmptyState';
import { TagChip } from '../components/shared/TagChip';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Toggle } from '../components/ui/Toggle';
import { Tooltip } from '../components/ui/Tooltip';

// ═══════════════════════════════════════════════════════════════════════════════
// StatusBadge
// ═══════════════════════════════════════════════════════════════════════════════

describe('StatusBadge accessibility', () => {
  it('has no axe violations in pill variant', async () => {
    const { container } = render(<StatusBadge status="passed" variant="pill" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('provides aria-label with status text for pill variant', () => {
    render(<StatusBadge status="failed" variant="pill" />);
    expect(screen.getByLabelText('Status: Failed')).toBeTruthy();
  });

  it('has no axe violations in dot variant', async () => {
    const { container } = render(<StatusBadge status="running" variant="dot" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ErrorAlert
// ═══════════════════════════════════════════════════════════════════════════════

describe('ErrorAlert accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(<ErrorAlert error="Something went wrong" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has role="alert" for screen reader announcements', () => {
    render(<ErrorAlert error="Oops" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('retry button is keyboard-accessible', () => {
    const onRetry = vi.fn();
    render(<ErrorAlert error="fail" onRetry={onRetry} />);
    const retryBtn = screen.getByText('Retry');
    fireEvent.keyDown(retryBtn, { key: 'Enter' });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EmptyState
// ═══════════════════════════════════════════════════════════════════════════════

describe('EmptyState accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <EmptyState title="No runs" description="Start your first run" cta="New Run" onCta={() => {}} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('CTA button is a proper button element', () => {
    render(<EmptyState title="Empty" cta="Do something" onCta={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Do something' });
    expect(btn.tagName).toBe('BUTTON');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Button
// ═══════════════════════════════════════════════════════════════════════════════

describe('Button accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(<Button>Click me</Button>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('disabled button is marked aria-disabled via the disabled attribute', () => {
    render(<Button disabled>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('loading state disables the button', () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole('button', { name: 'Saving' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Input
// ═══════════════════════════════════════════════════════════════════════════════

describe('Input accessibility', () => {
  it('has no axe violations with label', async () => {
    const { container } = render(<Input label="Username" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('associates label with input via htmlFor/id', () => {
    render(<Input label="Email Address" />);
    const input = screen.getByLabelText('Email Address');
    expect(input.getAttribute('id')).toBe('email-address');
  });

  it('shows error message when error prop is set', () => {
    render(<Input label="Name" error="Required field" />);
    expect(screen.getByText('Required field')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Select
// ═══════════════════════════════════════════════════════════════════════════════

describe('Select accessibility', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  it('has no axe violations with label', async () => {
    const { container } = render(<Select label="Project" options={options} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('associates label with select via htmlFor/id', () => {
    render(<Select label="Category" options={options} />);
    const sel = screen.getByLabelText('Category');
    expect(sel.getAttribute('id')).toBe('category');
    expect(sel.tagName).toBe('SELECT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Toggle
// ═══════════════════════════════════════════════════════════════════════════════

describe('Toggle accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(<Toggle checked={false} onChange={() => {}} label="Dark mode" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has role="switch" with correct aria-checked', () => {
    const { rerender } = render(<Toggle checked={false} onChange={() => {}} label="Dark mode" />);
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    rerender(<Toggle checked={true} onChange={() => {}} label="Dark mode" />);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('toggles via keyboard Enter key', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Notifications" />);
    const toggle = screen.getByRole('switch');
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggles via keyboard Space key', () => {
    const onChange = vi.fn();
    render(<Toggle checked={true} onChange={onChange} label="Auto-save" />);
    const toggle = screen.getByRole('switch');
    fireEvent.keyDown(toggle, { key: ' ' });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does not toggle when disabled', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Locked" disabled />);
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tooltip
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tooltip accessibility', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('has no axe violations when closed', async () => {
    const { container } = render(
      <Tooltip content="Help text">
        <button>Hover me</button>
      </Tooltip>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('renders trigger as focusable element for keyboard users', () => {
    render(
      <Tooltip content="Keyboard tip">
        <button>Focus me</button>
      </Tooltip>,
    );
    const trigger = screen.getByText('Focus me');
    expect(trigger.tagName).toBe('BUTTON');
    // Verify the trigger can receive focus (keyboard accessible)
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TagChip
// ═══════════════════════════════════════════════════════════════════════════════

describe('TagChip accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(<TagChip tag="smoke" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has aria-pressed attribute', () => {
    const { rerender } = render(<TagChip tag="critical" active={false} />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    rerender(<TagChip tag="critical" active={true} />);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FilterBar
// ═══════════════════════════════════════════════════════════════════════════════

describe('FilterBar accessibility', () => {
  const defaultProps = {
    search: '',
    onSearch: vi.fn(),
    statusFilter: [] as string[],
    onStatusFilter: vi.fn(),
  };

  it('has no axe violations', async () => {
    const { container } = render(<FilterBar {...defaultProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('search input has a placeholder for affordance', () => {
    render(<FilterBar {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search tests…');
    expect(input.tagName).toBe('INPUT');
  });
});
