import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Kbd } from './Kbd.js';

describe('Kbd', () => {
  describe('with children (no keys)', () => {
    it('renders a kbd element with the given text', () => {
      const html = renderToString(<Kbd>Enter</Kbd>);
      expect(html).toContain('<kbd');
      expect(html).toContain('Enter');
    });

    it('renders without crashing when children is undefined', () => {
      expect(() => renderToString(<Kbd />)).not.toThrow();
    });

    it('applies keyboard styling classes', () => {
      const html = renderToString(<Kbd>Ctrl</Kbd>);
      expect(html).toContain('font-mono');
      expect(html).toContain('rounded');
    });

    it('renders inline-flex layout class', () => {
      const html = renderToString(<Kbd>A</Kbd>);
      expect(html).toContain('inline-flex');
    });

    it('applies box-shadow via style attribute', () => {
      const html = renderToString(<Kbd>B</Kbd>);
      expect(html).toContain('box-shadow');
    });
  });

  describe('with keys array', () => {
    it('renders each key in a kbd element', () => {
      const html = renderToString(<Kbd keys={['Ctrl', 'C']} />);
      expect(html).toContain('Ctrl');
      expect(html).toContain('C');
    });

    it('renders a + separator between keys', () => {
      const html = renderToString(<Kbd keys={['Ctrl', 'Shift', 'P']} />);
      expect(html).toContain('+');
    });

    it('does NOT render + separator for a single key', () => {
      const html = renderToString(<Kbd keys={['Escape']} />);
      // Single key → no + separator span
      expect(html).not.toContain('mx-0.5');
    });

    it('renders correct number of + separators (n-1 for n keys)', () => {
      const html = renderToString(<Kbd keys={['Ctrl', 'Alt', 'Delete']} />);
      // 3 keys → 2 separators
      const count = (html.match(/mx-0\.5/g) || []).length;
      expect(count).toBe(2);
    });

    it('renders an outer span wrapper with inline-flex', () => {
      const html = renderToString(<Kbd keys={['A', 'B']} />);
      expect(html).toContain('inline-flex');
      expect(html).toContain('gap-0.5');
    });

    it('renders multiple kbd elements', () => {
      const html = renderToString(<Kbd keys={['Cmd', 'K']} />);
      const kbdCount = (html.match(/<kbd/g) || []).length;
      expect(kbdCount).toBe(2);
    });

    it('renders separator with correct style class', () => {
      const html = renderToString(<Kbd keys={['Ctrl', 'Z']} />);
      expect(html).toContain('text-text-tertiary');
    });
  });

  describe('keys vs children branch', () => {
    it('prefers keys array over children when both are provided', () => {
      // When keys is provided, children is ignored (keys branch is taken)
      const html = renderToString(<Kbd keys={['X']}>ignored children</Kbd>);
      expect(html).toContain('X');
      // The outer span from the keys branch should appear
      expect(html).toContain('gap-0.5');
    });
  });
});
