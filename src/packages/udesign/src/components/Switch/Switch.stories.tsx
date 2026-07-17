import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Check, X } from 'lucide-react';
import Switch from './index';

const meta = {
  title: 'UDesign/Switch',
  component: Switch,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['small', 'medium', 'large'],
    },
    iconPlacement: {
      control: 'select',
      options: ['inside', 'outside'],
    },
    labelPlacement: {
      control: 'select',
      options: ['inside', 'outside'],
    },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    defaultValue: true,
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <Switch size="small" defaultValue />
      <Switch size="medium" defaultValue />
      <Switch size="large" defaultValue />
    </div>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <Switch label={['开', '关']} defaultValue />
      <Switch label={['开', '关']} defaultValue={false} />
      <Switch size="large" label={['开', '关']} defaultValue />
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ width: 88, color: '#8c8c8c', fontSize: 13 }}>滑块内</span>
        <Switch
          defaultValue
          icon={[
            <Check key="on" size={12} strokeWidth={2.5} />,
            <X key="off" size={12} strokeWidth={2.5} />,
          ]}
          iconPlacement="inside"
        />
        <Switch
          defaultValue={false}
          icon={[
            <Check key="on" size={12} strokeWidth={2.5} />,
            <X key="off" size={12} strokeWidth={2.5} />,
          ]}
          iconPlacement="inside"
        />
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ width: 88, color: '#8c8c8c', fontSize: 13 }}>滑块外</span>
        <Switch
          defaultValue
          icon={[
            <Check key="on" size={12} strokeWidth={2.5} />,
            <X key="off" size={12} strokeWidth={2.5} />,
          ]}
          iconPlacement="outside"
        />
        <Switch
          defaultValue={false}
          icon={[
            <Check key="on" size={12} strokeWidth={2.5} />,
            <X key="off" size={12} strokeWidth={2.5} />,
          ]}
          iconPlacement="outside"
        />
      </div>
    </div>
  ),
};

export const IconPriority: Story = {
  name: 'Icon Over Label',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ width: 120, color: '#8c8c8c', fontSize: 13 }}>同在外部</span>
        <Switch
          defaultValue
          label={['开', '关']}
          icon={[
            <Check key="on" size={12} strokeWidth={2.5} />,
            <X key="off" size={12} strokeWidth={2.5} />,
          ]}
          iconPlacement="outside"
          labelPlacement="outside"
        />
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ width: 120, color: '#8c8c8c', fontSize: 13 }}>同在内部</span>
        <Switch
          defaultValue
          label={['开', '关']}
          icon={[
            <Check key="on" size={12} strokeWidth={2.5} />,
            <X key="off" size={12} strokeWidth={2.5} />,
          ]}
          iconPlacement="inside"
          labelPlacement="inside"
        />
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ width: 120, color: '#8c8c8c', fontSize: 13 }}>内外并存</span>
        <Switch
          defaultValue
          label={['开', '关']}
          icon={[
            <Check key="on" size={12} strokeWidth={2.5} />,
            <X key="off" size={12} strokeWidth={2.5} />,
          ]}
          iconPlacement="inside"
          labelPlacement="outside"
        />
      </div>
    </div>
  ),
};

export const CustomValue: Story = {
  render: () => {
    const [value, setValue] = useState<'open' | 'close'>('close');
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Switch
          customValue={['open', 'close']}
          value={value}
          label={['开', '关']}
          onChange={(next) => setValue(next as 'open' | 'close')}
        />
        <span>当前值：{value}</span>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16 }}>
      <Switch disabled defaultValue={false} />
      <Switch disabled defaultValue />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16 }}>
      <Switch loading defaultValue={false} />
      <Switch loading defaultValue />
    </div>
  ),
};

export const BeforeChange: Story = {
  render: () => {
    const [value, setValue] = useState(false);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Switch
          value={value}
          label={['开', '关']}
          beforeChange={() =>
            new Promise((resolve) => {
              setTimeout(() => resolve(true), 800);
            })
          }
          onChange={(next) => setValue(Boolean(next))}
        />
        <span style={{ color: '#595959', fontSize: 13 }}>
          切换前会等待异步校验（约 0.8s）
        </span>
      </div>
    );
  },
};
