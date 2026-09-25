/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn()', () => {
  it('merges single class', () => {
    expect(cn('text-red-500')).toBe('text-red-500');
  });

  it('merges multiple classes', () => {
    expect(cn('text-red-500', 'font-bold')).toBe('text-red-500 font-bold');
  });

  it('handles conditionals', () => {
    expect(cn('text-red-500', false && 'hidden', 'font-bold')).toBe('text-red-500 font-bold');
  });

  it('resolves Tailwind conflicts (last wins)', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });

  it('handles arrays', () => {
    expect(cn(['text-red-500', 'font-bold'])).toBe('text-red-500 font-bold');
  });

  it('handles objects', () => {
    expect(cn({ 'text-red-500': true, 'font-bold': false })).toBe('text-red-500');
  });

  it('handles undefined and null', () => {
    expect(cn('text-red-500', undefined, null, 'font-bold')).toBe('text-red-500 font-bold');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });

  it('combines complex tailwind classes with conflicts', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});
