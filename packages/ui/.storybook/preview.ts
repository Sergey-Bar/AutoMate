import React from 'react';
import type { Preview, Decorator } from '@storybook/react';

const withTheme: Decorator = (Story) => {
  return React.createElement(
    'div',
    {
      'data-theme': 'dark',
      style: { padding: '1rem', background: 'var(--color-bg, #0f1117)', minHeight: '100vh' },
    },
    React.createElement(Story, null),
  );
};

const preview: Preview = {
  decorators: [withTheme],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
