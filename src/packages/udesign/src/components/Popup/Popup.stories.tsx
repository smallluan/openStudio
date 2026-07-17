import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Button from '../Button';
import Popup from './index';

const meta = {
  title: 'UDesign/Popup',
  component: Popup,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    placement: {
      control: 'select',
      options: [
        'top',
        'left',
        'right',
        'bottom',
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
        'left-top',
        'left-bottom',
        'right-top',
        'right-bottom',
      ],
    },
    trigger: {
      control: 'select',
      options: ['hover', 'click', 'focus', 'mousedown', 'context-menu'],
    },
    showArrow: { control: 'boolean' },
    destroyOnClose: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Popup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    content: '这是一段 Popup 浮层内容',
    placement: 'top',
    showArrow: true,
    children: <Button theme="primary">悬停我</Button>,
  },
};

export const ClickTrigger: Story = {
  render: () => (
    <Popup
      trigger="click"
      showArrow
      placement="bottom"
      content="点击触发，再次点击或点外部关闭"
    >
      <Button theme="primary">点击打开</Button>
    </Popup>
  ),
};

export const Placements: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 120px)',
        gap: 24,
        justifyItems: 'center',
        padding: 48,
      }}
    >
      {(
        [
          'top-left',
          'top',
          'top-right',
          'left',
          'bottom',
          'right',
          'bottom-left',
          'bottom',
          'bottom-right',
        ] as const
      ).map((placement, index) => (
        <Popup
          key={`${placement}-${index}`}
          placement={placement}
          showArrow
          content={`placement: ${placement}`}
        >
          <Button size="small">{placement}</Button>
        </Popup>
      ))}
    </div>
  ),
};

export const AutoFlip: Story = {
  name: 'Auto Flip (避障)',
  render: () => (
    <div
      style={{
        width: 320,
        height: 220,
        overflow: 'auto',
        border: '1px solid #d9d9d9',
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div style={{ height: 280 }} />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Popup
          placement="bottom"
          showArrow
          content="靠近边缘时会自动 flip / shift，避免被裁切"
        >
          <Button theme="primary">滚到边缘再悬停</Button>
        </Popup>
      </div>
      <div style={{ height: 280 }} />
    </div>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [visible, setVisible] = useState(false);
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Popup
          trigger="click"
          visible={visible}
          showArrow
          content="受控模式 Popup"
          onVisibleChange={setVisible}
        >
          <Button theme="primary">{visible ? '已打开' : '打开'}</Button>
        </Popup>
        <Button variant="outline" onClick={() => setVisible((v) => !v)}>
          外部切换
        </Button>
      </div>
    );
  },
};

export const ContextMenu: Story = {
  render: () => (
    <Popup
      trigger="context-menu"
      showArrow
      placement="right-top"
      content="右键菜单内容"
    >
      <div
        style={{
          width: 200,
          height: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px dashed #bfbfbf',
          borderRadius: 8,
          color: '#8c8c8c',
        }}
      >
        在此区域右键
      </div>
    </Popup>
  ),
};

export const CustomStyle: Story = {
  render: () => (
    <Popup
      trigger="click"
      showArrow
      placement="bottom"
      overlayInnerStyle={{
        background: '#1677ff',
        color: '#fff',
        border: 'none',
        minWidth: 180,
      }}
      content="自定义浮层内容样式"
    >
      <Button theme="primary">自定义样式</Button>
    </Popup>
  ),
};
