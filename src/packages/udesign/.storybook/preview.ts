import type { Preview } from '@storybook/react';
import '../src/styles/css-variables.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#1f1f1f' },
      ],
    },
  },
};

export default preview;
