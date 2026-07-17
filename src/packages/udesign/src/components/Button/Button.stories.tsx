import type { Meta, StoryObj } from '@storybook/react';
import { Search, Download, Star, ArrowRight } from 'lucide-react';
import Button from './index';

const meta = {
  title: 'UDesign/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    theme: {
      control: 'select',
      options: ['default', 'primary', 'danger', 'warning', 'success'],
    },
    variant: {
      control: 'select',
      options: ['base', 'outline', 'dashed', 'text'],
    },
    size: {
      control: 'select',
      options: ['small', 'medium', 'large'],
    },
    shape: {
      control: 'select',
      options: ['rectangle', 'square', 'round', 'circle'],
    },
    tag: {
      control: 'select',
      options: ['button', 'a', 'div'],
    },
    type: {
      control: 'select',
      options: ['submit', 'reset', 'button'],
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// 基础按钮
export const Default: Story = {
  args: {
    children: '默认按钮',
    theme: 'default',
    variant: 'base',
    size: 'medium',
  },
};

// 主题按钮
export const Themes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button theme="default">默认</Button>
      <Button theme="primary">主要</Button>
      <Button theme="danger">危险</Button>
      <Button theme="warning">警告</Button>
      <Button theme="success">成功</Button>
    </div>
  ),
};

// 变体按钮
export const Variants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button variant="base" theme="primary">基础</Button>
      <Button variant="outline" theme="primary">线框</Button>
      <Button variant="dashed" theme="primary">虚线</Button>
      <Button variant="text" theme="primary">文字</Button>
    </div>
  ),
};

// 尺寸按钮
export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Button size="small" theme="primary">小按钮</Button>
      <Button size="medium" theme="primary">中按钮</Button>
      <Button size="large" theme="primary">大按钮</Button>
    </div>
  ),
};

// 形状按钮
export const Shapes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button shape="rectangle" theme="primary">长方形</Button>
      <Button shape="round" theme="primary">圆角</Button>
      <Button shape="square" theme="primary">
        <Star size={16} />
      </Button>
      <Button shape="circle" theme="primary">
        <Star size={16} />
      </Button>
    </div>
  ),
};

// 带图标按钮
export const WithIcon: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button icon={<Search size={16} />} theme="primary">搜索</Button>
      <Button icon={<Download size={16} />} variant="outline">下载</Button>
      <Button suffix={<ArrowRight size={16} />}>下一步</Button>
    </div>
  ),
};

// 幽灵按钮
export const Ghost: Story = {
  parameters: {
    backgrounds: { default: 'dark' },
  },
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button ghost>默认</Button>
      <Button ghost theme="primary">主要</Button>
      <Button ghost theme="danger">危险</Button>
      <Button ghost theme="warning">警告</Button>
      <Button ghost theme="success">成功</Button>
    </div>
  ),
};

// 加载状态
export const Loading: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button loading theme="primary">加载中</Button>
      <Button loading variant="outline" theme="primary">加载中</Button>
      <Button loading shape="circle" theme="primary" />
    </div>
  ),
};

// 禁用状态
export const Disabled: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button disabled>禁用</Button>
      <Button disabled theme="primary">禁用</Button>
      <Button disabled variant="outline" theme="primary">禁用</Button>
      <Button disabled variant="text" theme="primary">禁用</Button>
    </div>
  ),
};

// 块级按钮
export const Block: Story = {
  render: () => (
    <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Button block theme="primary">块级按钮</Button>
      <Button block variant="outline">块级按钮</Button>
    </div>
  ),
};

// 链接按钮
export const LinkButton: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button href="https://example.com" theme="primary">链接按钮</Button>
      <Button href="https://example.com" variant="outline" theme="primary">链接按钮</Button>
    </div>
  ),
};

// 使用 tag=div 解决禁用按钮无法显示浮层
export const TagDiv: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button tag="div" disabled>
        tag=div 禁用（可显示 Tooltip）
      </Button>
      <Button tag="div" theme="primary">
        tag=div 普通
      </Button>
    </div>
  ),
};
