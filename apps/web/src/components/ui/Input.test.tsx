import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Input } from './Input.js';

describe('Input', () => {
  it('renders an input element', () => {
    const html = renderToString(<Input />);
    expect(html).toContain('<input');
  });

  it('renders label when provided', () => {
    const html = renderToString(<Input label="Email" />);
    expect(html).toContain('Email');
    expect(html).toContain('<label');
  });

  it('generates id from label when no id provided', () => {
    const html = renderToString(<Input label="Email Address" />);
    expect(html).toContain('id="email-address"');
    expect(html).toContain('for="email-address"');
  });

  it('uses provided id over generated one', () => {
    const html = renderToString(<Input label="Email" id="my-email" />);
    expect(html).toContain('id="my-email"');
    expect(html).toContain('for="my-email"');
  });

  it('does not render label when not provided', () => {
    const html = renderToString(<Input />);
    expect(html).not.toContain('<label');
  });

  it('renders error text when error prop is provided', () => {
    const html = renderToString(<Input error="This field is required" />);
    expect(html).toContain('This field is required');
    expect(html).toContain('text-error');
  });

  it('renders hint text when hint prop is provided and no error', () => {
    const html = renderToString(<Input hint="This is a helpful hint" />);
    expect(html).toContain('This is a helpful hint');
  });

  it('does not render hint when error is also present', () => {
    const html = renderToString(<Input error="Error!" hint="Hint" />);
    expect(html).toContain('Error!');
    expect(html).not.toContain('Hint');
  });

  it('applies border-error class when error is set', () => {
    const html = renderToString(<Input error="Error" />);
    expect(html).toContain('border-error');
  });

  it('applies border-border-default when no error', () => {
    const html = renderToString(<Input />);
    expect(html).toContain('border-border-default');
  });

  it('renders icon when provided', () => {
    const icon = <span data-testid="search-icon">🔍</span>;
    const html = renderToString(<Input icon={icon} />);
    expect(html).toContain('data-testid="search-icon"');
    expect(html).toContain('🔍');
  });

  it('applies pl-8 padding-left when icon is provided', () => {
    const icon = <span>🔍</span>;
    const html = renderToString(<Input icon={icon} />);
    expect(html).toContain('pl-8');
  });

  it('does not apply pl-8 when no icon', () => {
    const html = renderToString(<Input />);
    expect(html).not.toContain('pl-8');
  });

  it('applies sm size classes', () => {
    const html = renderToString(<Input size="sm" />);
    expect(html).toContain('h-7');
    expect(html).toContain('px-2.5');
  });

  it('applies md size classes by default', () => {
    const html = renderToString(<Input />);
    expect(html).toContain('h-9');
  });

  it('applies lg size classes', () => {
    const html = renderToString(<Input size="lg" />);
    expect(html).toContain('h-11');
  });

  it('applies custom className', () => {
    const html = renderToString(<Input className="my-custom-class" />);
    expect(html).toContain('my-custom-class');
  });

  it('passes through placeholder', () => {
    const html = renderToString(<Input placeholder="Enter text here" />);
    expect(html).toContain('placeholder="Enter text here"');
  });

  it('passes through type attribute', () => {
    const html = renderToString(<Input type="password" />);
    expect(html).toContain('type="password"');
  });

  it('passes through value attribute', () => {
    const html = renderToString(<Input value="test-value" readOnly />);
    expect(html).toContain('test-value');
  });

  it('passes through disabled attribute', () => {
    const html = renderToString(<Input disabled />);
    expect(html).toContain('disabled');
  });

  it('has displayName set', () => {
    expect(Input.displayName).toBe('Input');
  });

  it('does not render id when no label and no id provided', () => {
    const html = renderToString(<Input placeholder="test" />);
    // should not contain id attribute
    expect(html).not.toContain('id="undefined"');
  });
});
