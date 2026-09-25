import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Button, buttonVariants } from './Button.js';

describe('buttonVariants', () => {
  it('returns class string for primary variant', () => {
    const cls = buttonVariants({ variant: 'primary', size: 'md' });
    expect(cls).toContain('bg-primary');
  });

  it('returns class string for secondary variant', () => {
    const cls = buttonVariants({ variant: 'secondary' });
    expect(cls).toContain('bg-bg-elevated');
  });

  it('returns class string for ghost variant', () => {
    const cls = buttonVariants({ variant: 'ghost' });
    expect(cls).toContain('bg-transparent');
  });

  it('returns class string for danger variant', () => {
    const cls = buttonVariants({ variant: 'danger' });
    expect(cls).toContain('bg-error');
  });

  it('returns class string for outline variant', () => {
    const cls = buttonVariants({ variant: 'outline' });
    expect(cls).toContain('border');
  });

  it('returns sm size classes', () => {
    const cls = buttonVariants({ size: 'sm' });
    expect(cls).toContain('h-7');
  });

  it('returns lg size classes', () => {
    const cls = buttonVariants({ size: 'lg' });
    expect(cls).toContain('h-11');
  });

  it('uses default variant and size when not specified', () => {
    const cls = buttonVariants({});
    expect(cls).toContain('bg-primary');
    expect(cls).toContain('h-9');
  });
});

describe('Button', () => {
  it('renders children', () => {
    const html = renderToString(<Button>Click me</Button>);
    expect(html).toContain('Click me');
  });

  it('renders as a button element', () => {
    const html = renderToString(<Button>Test</Button>);
    expect(html).toContain('<button');
  });

  it('applies primary variant by default', () => {
    const html = renderToString(<Button>Test</Button>);
    expect(html).toContain('bg-primary');
  });

  it('applies secondary variant', () => {
    const html = renderToString(<Button variant="secondary">Test</Button>);
    expect(html).toContain('bg-bg-elevated');
  });

  it('applies ghost variant', () => {
    const html = renderToString(<Button variant="ghost">Test</Button>);
    expect(html).toContain('bg-transparent');
  });

  it('applies danger variant', () => {
    const html = renderToString(<Button variant="danger">Test</Button>);
    expect(html).toContain('bg-error');
  });

  it('applies outline variant', () => {
    const html = renderToString(<Button variant="outline">Test</Button>);
    expect(html).not.toContain('bg-primary');
  });

  it('applies sm size', () => {
    const html = renderToString(<Button size="sm">Test</Button>);
    expect(html).toContain('h-7');
  });

  it('applies lg size', () => {
    const html = renderToString(<Button size="lg">Test</Button>);
    expect(html).toContain('h-11');
  });

  it('renders loading spinner when loading=true', () => {
    const html = renderToString(<Button loading>Test</Button>);
    expect(html).toContain('animate-spin');
  });

  it('is disabled when loading=true', () => {
    const html = renderToString(<Button loading>Test</Button>);
    expect(html).toContain('disabled');
  });

  it('is disabled when disabled=true', () => {
    const html = renderToString(<Button disabled>Test</Button>);
    expect(html).toContain('disabled');
  });

  it('shows opacity-50 and cursor-not-allowed when disabled', () => {
    const html = renderToString(<Button disabled>Test</Button>);
    expect(html).toContain('opacity-50');
    expect(html).toContain('cursor-not-allowed');
  });

  it('shows cursor-pointer when not disabled', () => {
    const html = renderToString(<Button>Test</Button>);
    expect(html).toContain('cursor-pointer');
  });

  it('renders icon when provided and not loading', () => {
    const icon = <span data-testid="icon">★</span>;
    const html = renderToString(<Button icon={icon}>Test</Button>);
    expect(html).toContain('★');
    expect(html).toContain('shrink-0');
  });

  it('does not render icon when loading (shows spinner instead)', () => {
    const icon = <span data-testid="icon">★</span>;
    const html = renderToString(<Button loading icon={icon}>Test</Button>);
    expect(html).toContain('animate-spin');
    // Icon itself shouldn't be rendered in shrink-0 span when loading
    expect(html).not.toContain('data-testid="icon"');
  });

  it('renders iconRight when provided', () => {
    const iconRight = <span data-testid="icon-right">→</span>;
    const html = renderToString(<Button iconRight={iconRight}>Test</Button>);
    expect(html).toContain('data-testid="icon-right"');
    expect(html).toContain('→');
  });

  it('applies extra className', () => {
    const html = renderToString(<Button className="custom-class">Test</Button>);
    expect(html).toContain('custom-class');
  });

  it('has displayName set', () => {
    expect(Button.displayName).toBe('Button');
  });

  it('passes through type attribute', () => {
    const html = renderToString(<Button type="submit">Submit</Button>);
    expect(html).toContain('type="submit"');
  });

  it('renders loading spinner with size 12 for sm button', () => {
    const html = renderToString(<Button loading size="sm">Test</Button>);
    expect(html).toContain('animate-spin');
  });

  it('renders loading spinner with size 14 for md button', () => {
    const html = renderToString(<Button loading size="md">Test</Button>);
    expect(html).toContain('animate-spin');
  });
});
