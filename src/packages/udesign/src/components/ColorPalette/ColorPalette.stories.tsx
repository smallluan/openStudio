import type { Meta, StoryObj } from '@storybook/react';
import ColorPalette from './index';

const meta = {
  title: 'UDesign/Colors/ColorPalette',
  component: ColorPalette,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ColorPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithCustomClass: Story = {
  args: {
    className: 'custom-wrapper',
  },
};
