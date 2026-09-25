import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Select } from './Select.js';

const baseOptions = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C' },
];

describe('Select', () => {
  it('renders a select element', () => {
    const html = renderToString(<Select options={baseOptions} />);
    expect(html).toContain('<select');
  });

  it('renders all options', () => {
    const html = renderToString(<Select options={baseOptions} />);
    expect(html).toContain('Option A');
    expect(html).toContain('Option B');
    expect(html).toContain('Option C');
  });

  it('renders option values', () => {
    const html = renderToString(<Select options={baseOptions} />);
    expect(html).toContain('value="a"');
    expect(html).toContain('value="b"');
    expect(html).toContain('value="c"');
  });

  it('renders placeholder as disabled option when provided', () => {
    const html = renderToString(<Select options={baseOptions} placeholder="Choose one" />);
    expect(html).toContain('Choose one');
    expect(html).toContain('disabled');
  });

  it('does not render placeholder option when not provided', () => {
    const html = renderToString(<Select options={baseOptions} />);
    // The only disabled attribute should not appear (no placeholder)
    expect(html).not.toContain('value=""');
  });

  it('renders label when provided', () => {
    const html = renderToString(<Select options={baseOptions} label="Sort by" />);
    expect(html).toContain('Sort by');
    expect(html).toContain('<label');
  });

  it('generates id from label when no id provided', () => {
    const html = renderToString(<Select options={baseOptions} label="Sort By" />);
    expect(html).toContain('id="sort-by"');
    expect(html).toContain('for="sort-by"');
  });

  it('uses provided id over generated one', () => {
    const html = renderToString(<Select options={baseOptions} label="Sort" id="custom-id" />);
    expect(html).toContain('id="custom-id"');
  });

  it('does not render label when not provided', () => {
    const html = renderToString(<Select options={[]} />);
    expect(html).not.toContain('<label');
  });

  it('renders error text when provided', () => {
    const html = renderToString(<Select options={baseOptions} error="Select is required" />);
    expect(html).toContain('Select is required');
    expect(html).toContain('text-error');
  });

  it('applies border-error class when error is set', () => {
    const html = renderToString(<Select options={baseOptions} error="Error" />);
    expect(html).toContain('border-error');
  });

  it('applies border-border-default when no error', () => {
    const html = renderToString(<Select options={baseOptions} />);
    expect(html).toContain('border-border-default');
  });

  it('renders hint text when provided and no error', () => {
    const html = renderToString(<Select options={baseOptions} hint="Please choose an option" />);
    expect(html).toContain('Please choose an option');
  });

  it('does not render hint when error is present', () => {
    const html = renderToString(<Select options={baseOptions} error="Error!" hint="Hint" />);
    expect(html).toContain('Error!');
    expect(html).not.toContain('Hint');
  });

  it('applies sm size classes', () => {
    const html = renderToString(<Select options={baseOptions} size="sm" />);
    expect(html).toContain('h-7');
  });

  it('applies md size classes by default', () => {
    const html = renderToString(<Select options={baseOptions} />);
    expect(html).toContain('h-9');
  });

  it('applies lg size classes', () => {
    const html = renderToString(<Select options={baseOptions} size="lg" />);
    expect(html).toContain('h-11');
  });

  it('renders ChevronDown icon', () => {
    const html = renderToString(<Select options={baseOptions} />);
    // ChevronDown renders as an SVG
    expect(html).toContain('<svg');
  });

  it('applies custom className', () => {
    const html = renderToString(<Select options={baseOptions} className="custom-select" />);
    expect(html).toContain('custom-select');
  });

  it('renders empty options list', () => {
    const html = renderToString(<Select options={[]} />);
    expect(html).toContain('<select');
    // No options rendered
    expect(html).not.toContain('<option');
  });

  it('has displayName set', () => {
    expect(Select.displayName).toBe('Select');
  });

  it('passes through disabled attribute', () => {
    const html = renderToString(<Select options={baseOptions} disabled />);
    expect(html).toContain('disabled');
  });
});
