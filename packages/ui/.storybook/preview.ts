import { createElement, type ReactElement } from 'react';
import type { Preview } from '@storybook/react';
import '../src/storybook.css';

/**
 * One import, and it is the one that matters.
 *
 * `src/storybook.css` is `@import 'tailwindcss'` plus the three token stylesheets,
 * in the same order as `apps/web/src/index.css`: fonts, then theme, then motion.
 * That order is not cosmetic — the `body` rule in the application reads
 * `--automate-font-sans`, so `fonts.css` has to be resolved first, and the three
 * files are one design authority split by concern. Importing the three
 * stylesheets individually from here instead would work and would be worse: the
 * load order would live in a component file where nobody looks for it, and the
 * `@import 'tailwindcss'` that makes Tailwind run would be one file away from the
 * `@source` behaviour it needs. See the header in `src/storybook.css` for why that
 * file is in `src/` at all.
 *
 * **Without it, Storybook is a component viewer with no theme.** A `Card` would
 * render `bg-surface-muted` as a transparent box and `text-fg-muted` as the
 * browser's inherited colour, and every token in this package would look broken in
 * the one place somebody looks at components on purpose.
 *
 * **`createElement` rather than JSX, so the file is `preview.ts`.** The name is
 * what Storybook's docs, every config snippet and every reader expects, and it is
 * worth one `createElement` call to keep it. There is exactly one element here.
 */
const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  globalTypes: {
    theme: {
      description:
        'The theme the plane is authored in. `data-theme` on the story wrapper, and nothing else.',
      defaultValue: 'dark',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = (context.globals['theme'] as string | undefined) ?? 'dark';
      return createElement(
        'div',
        {
          'data-theme': theme,
          // The four properties `index.css` sets on `body`, which does not exist
          // inside a story. Same tokens, same values, different selector — and
          // stated as such rather than worked around with a hardcoded colour,
          // because a hardcoded colour in a preview file is a second palette.
          style: {
            background: 'var(--automate-surface)',
            color: 'var(--automate-fg)',
            fontFamily: 'var(--automate-font-sans)',
            colorScheme: theme,
            minHeight: '100vh',
            padding: '2rem',
          },
        },
        Story() as ReactElement,
      );
    },
  ],
};

export default preview;
