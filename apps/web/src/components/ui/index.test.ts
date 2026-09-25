import { describe, expect, it } from 'vitest';
import * as uiIndex from './index.js';

describe('UI index barrel exports', () => {
  it('exports Button as a forwardRef object', () => {
    expect(uiIndex.Button).toBeDefined();
    expect(typeof uiIndex.Button).toBe('object');
    expect(uiIndex.Button).not.toBeNull();
    // forwardRef components expose a $$typeof symbol and a render function
    expect(uiIndex.Button).toHaveProperty('$$typeof');
    expect(uiIndex.Button).toHaveProperty('render');
  });

  it('exports buttonVariants', () => {
    expect(uiIndex.buttonVariants).toBeDefined();
    expect(typeof uiIndex.buttonVariants).toBe('function');
  });

  it('exports Input as a forwardRef object', () => {
    expect(uiIndex.Input).toBeDefined();
    expect(typeof uiIndex.Input).toBe('object');
    expect(uiIndex.Input).not.toBeNull();
    expect(uiIndex.Input).toHaveProperty('$$typeof');
    expect(uiIndex.Input).toHaveProperty('render');
  });

  it('exports Select as a forwardRef object', () => {
    expect(uiIndex.Select).toBeDefined();
    expect(typeof uiIndex.Select).toBe('object');
    expect(uiIndex.Select).not.toBeNull();
    expect(uiIndex.Select).toHaveProperty('$$typeof');
    expect(uiIndex.Select).toHaveProperty('render');
  });

  it('exports Toggle as a named function component', () => {
    expect(uiIndex.Toggle).toBeDefined();
    expect(typeof uiIndex.Toggle).toBe('function');
    expect(uiIndex.Toggle.name).toBe('Toggle');
  });

  it('exports Tooltip as a named function component', () => {
    expect(uiIndex.Tooltip).toBeDefined();
    expect(typeof uiIndex.Tooltip).toBe('function');
    expect(uiIndex.Tooltip.name).toBe('Tooltip');
  });

  it('exports Kbd as a named function component', () => {
    expect(uiIndex.Kbd).toBeDefined();
    expect(typeof uiIndex.Kbd).toBe('function');
    expect(uiIndex.Kbd.name).toBe('Kbd');
  });

  it('buttonVariants returns distinct class strings per variant', () => {
    const primary = uiIndex.buttonVariants({ variant: 'primary' });
    const destructive = uiIndex.buttonVariants({ variant: 'destructive' });
    expect(typeof primary).toBe('string');
    expect(primary.length).toBeGreaterThan(0);
    expect(typeof destructive).toBe('string');
    expect(destructive.length).toBeGreaterThan(0);
    expect(primary).not.toBe(destructive);
  });
});
