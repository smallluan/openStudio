import type { Preview } from '@storybook/react';
import '../src/styles/css-variables.css';
import '../src/styles/variables.less';

const preview: Preview = {
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
