export const typography = {
  fontFamily: {
    /**
     * The two families (D6-5), named to match `tokens/fonts.css` and the stack
     * `apps/web/src/index.css` sets on `body`.
     *
     * This used to say `Inter`, which is not loaded anywhere in the repository:
     * the app rendered in the OS stack and this record claimed otherwise. It is
     * dead code — `tailwindPreset` at `tokens/index.ts` has no importer, and the
     * A2 sweep deletes it — but a dead token that names the wrong font is a
     * second authority for a decision this file does not make, so it names the
     * real one while it is still here.
     */
    sans: ['Archivo', 'Archivo Fallback', 'ui-sans-serif', 'system-ui', 'sans-serif'],
    mono: ['JetBrains Mono', 'JetBrains Mono Fallback', 'ui-monospace', 'monospace'],
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
};
