/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Toggle } from './Toggle.js';

// Mock framer-motion since it uses DOM APIs not available in node env
vi.mock('framer-motion', () => ({
  motion: {
    span: ({ children, style, className }: { children?: React.ReactNode; style?: React.CSSProperties; className?: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (require('react') as any).createElement('span', { style, className }, children),
    div: ({ children, style, className }: { children?: React.ReactNode; style?: React.CSSProperties; className?: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (require('react') as any).createElement('div', { style, className }, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  spring: { snappy: { type: 'spring' } },
}));

describe('Toggle', () => {
  it('renders a button with role=switch', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('role="switch"');
  });

  it('renders label when provided', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} label="Enable feature" />);
    expect(html).toContain('Enable feature');
  });

  it('does not render label text when not provided', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).not.toContain('<span class=');
  });

  it('sets aria-checked=true when checked', () => {
    const html = renderToString(<Toggle checked={true} onChange={() => {}} />);
    expect(html).toContain('aria-checked="true"');
  });

  it('sets aria-checked=false when not checked', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('aria-checked="false"');
  });

  it('applies bg-primary when checked', () => {
    const html = renderToString(<Toggle checked={true} onChange={() => {}} />);
    expect(html).toContain('bg-primary');
  });

  it('applies bg-bg-surface when not checked', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('bg-bg-surface');
  });

  it('shows disabled attribute when disabled', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} disabled />);
    expect(html).toContain('disabled');
  });

  it('shows opacity-50 and cursor-not-allowed when disabled', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} disabled />);
    expect(html).toContain('opacity-50');
    expect(html).toContain('cursor-not-allowed');
  });

  it('shows cursor-pointer when not disabled', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('cursor-pointer');
  });

  it('applies sm size track classes', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} size="sm" />);
    expect(html).toContain('w-7');
    expect(html).toContain('h-4');
  });

  it('applies md size track classes by default', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('w-9');
    expect(html).toContain('h-5');
  });

  it('generates toggle id from label when no id provided', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} label="My Toggle" />);
    expect(html).toContain('toggle-my-toggle');
  });

  it('uses provided id', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} id="custom-toggle" />);
    expect(html).toContain('id="custom-toggle"');
  });

  it('renders thumb span with correct left position when checked', () => {
    const html = renderToString(<Toggle checked={true} onChange={() => {}} />);
    // For md size, translate is 16px
    expect(html).toContain('16px');
  });

  it('renders thumb span at 2px when not checked', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('2px');
  });

  it('renders thumb with white background', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('#fff');
  });
});

// ─── Event handler coverage via direct component function invocation ──────────
// These tests call the component as a plain function to obtain the React element
// tree, then directly invoke the event handler props to cover lines 37-41.

describe('Toggle event handlers (lines 37-41)', () => {
  // Helper: call component, find the button child (label > button)
  function getButtonProps(props: Parameters<typeof Toggle>[0]) {
    const labelEl = Toggle(props) as React.ReactElement<{ children: React.ReactNode }>;
    // labelEl is <label>. Its first child is the <button>
    const children = React.Children.toArray(labelEl.props.children);
    const button = children[0] as React.ReactElement<{
      onClick: () => void;
      onKeyDown: (e: Partial<React.KeyboardEvent>) => void;
    }>;
    return button.props;
  }

  it('onClick calls onChange(!checked) when not disabled', () => {
    const onChange = vi.fn();
    const { onClick } = getButtonProps({ checked: false, onChange });
    onClick();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('onClick calls onChange(!checked) when checked=true', () => {
    const onChange = vi.fn();
    const { onClick } = getButtonProps({ checked: true, onChange });
    onClick();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('onClick does NOT call onChange when disabled', () => {
    const onChange = vi.fn();
    const { onClick } = getButtonProps({ checked: false, onChange, disabled: true });
    onClick();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('onKeyDown with Space key calls onChange(!checked)', () => {
    const onChange = vi.fn();
    const { onKeyDown } = getButtonProps({ checked: false, onChange });
    const preventDefault = vi.fn();
    onKeyDown({ key: ' ', preventDefault });
    expect(onChange).toHaveBeenCalledWith(true);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('onKeyDown with Enter key calls onChange(!checked)', () => {
    const onChange = vi.fn();
    const { onKeyDown } = getButtonProps({ checked: false, onChange });
    const preventDefault = vi.fn();
    onKeyDown({ key: 'Enter', preventDefault });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('onKeyDown with other keys does NOT call onChange', () => {
    const onChange = vi.fn();
    const { onKeyDown } = getButtonProps({ checked: false, onChange });
    onKeyDown({ key: 'Tab', preventDefault: vi.fn() });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('onKeyDown with Space key does NOT call onChange when disabled', () => {
    const onChange = vi.fn();
    const { onKeyDown } = getButtonProps({ checked: false, onChange, disabled: true });
    onKeyDown({ key: ' ', preventDefault: vi.fn() });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// Mock framer-motion since it uses DOM APIs not available in node env
vi.mock('framer-motion', () => ({
  motion: {
    span: ({ children, style, className }: { children?: React.ReactNode; style?: React.CSSProperties; className?: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (require('react') as any).createElement('span', { style, className }, children),
    div: ({ children, style, className }: { children?: React.ReactNode; style?: React.CSSProperties; className?: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (require('react') as any).createElement('div', { style, className }, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  spring: { snappy: { type: 'spring' } },
}));

describe('Toggle', () => {
  it('renders a button with role=switch', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('role="switch"');
  });

  it('renders label when provided', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} label="Enable feature" />);
    expect(html).toContain('Enable feature');
  });

  it('does not render label text when not provided', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).not.toContain('<span class=');
  });

  it('sets aria-checked=true when checked', () => {
    const html = renderToString(<Toggle checked={true} onChange={() => {}} />);
    expect(html).toContain('aria-checked="true"');
  });

  it('sets aria-checked=false when not checked', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('aria-checked="false"');
  });

  it('applies bg-primary when checked', () => {
    const html = renderToString(<Toggle checked={true} onChange={() => {}} />);
    expect(html).toContain('bg-primary');
  });

  it('applies bg-bg-surface when not checked', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('bg-bg-surface');
  });

  it('shows disabled attribute when disabled', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} disabled />);
    expect(html).toContain('disabled');
  });

  it('shows opacity-50 and cursor-not-allowed when disabled', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} disabled />);
    expect(html).toContain('opacity-50');
    expect(html).toContain('cursor-not-allowed');
  });

  it('shows cursor-pointer when not disabled', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('cursor-pointer');
  });

  it('applies sm size track classes', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} size="sm" />);
    expect(html).toContain('w-7');
    expect(html).toContain('h-4');
  });

  it('applies md size track classes by default', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('w-9');
    expect(html).toContain('h-5');
  });

  it('generates toggle id from label when no id provided', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} label="My Toggle" />);
    expect(html).toContain('toggle-my-toggle');
  });

  it('uses provided id', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} id="custom-toggle" />);
    expect(html).toContain('id="custom-toggle"');
  });

  it('renders thumb span with correct left position when checked', () => {
    const html = renderToString(<Toggle checked={true} onChange={() => {}} />);
    // For md size, translate is 16px
    expect(html).toContain('16px');
  });

  it('renders thumb span at 2px when not checked', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('2px');
  });

  it('renders thumb with white background', () => {
    const html = renderToString(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain('#fff');
  });
});
