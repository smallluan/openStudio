import type { Meta, StoryObj } from '@storybook/react';
import { Search, User, Info } from 'lucide-react';
import { useState } from 'react';
import Input from './index';

const meta = {
  title: 'UDesign/Input',
  component: Input,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['small', 'medium', 'large'],
    },
    status: {
      control: 'select',
      options: ['default', 'success', 'warning', 'error'],
    },
    align: {
      control: 'select',
      options: ['left', 'center', 'right'],
    },
    type: {
      control: 'select',
      options: ['text', 'number', 'url', 'tel', 'password', 'search'],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: '请输入内容',
    size: 'medium',
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Input size="small" placeholder="小尺寸" />
      <Input size="medium" placeholder="中尺寸" />
      <Input size="large" placeholder="大尺寸" />
    </div>
  ),
};

export const WithPrefixSuffix: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Input prefixIcon={<Search size={16} />} placeholder="搜索" />
      <Input suffixIcon={<User size={16} />} placeholder="用户名" />
      <Input
        prefixIcon={<Search size={16} />}
        suffix="元"
        placeholder="金额"
      />
    </div>
  ),
};

export const Clearable: Story = {
  render: function ClearableStory() {
    const [value, setValue] = useState('可清空的内容');
    return (
      <Input
        clearable
        value={value}
        onChange={(v) => setValue(v)}
        placeholder="输入后悬浮显示清除按钮"
      />
    );
  },
};

export const ShowClearOnEmpty: Story = {
  args: {
    clearable: true,
    showClearIconOnEmpty: true,
    placeholder: '空内容时悬浮也显示清除按钮',
  },
};

export const WithLabel: Story = {
  args: {
    label: '用户名',
    placeholder: '请输入用户名',
  },
};

export const Status: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Input status="default" placeholder="默认状态" tips="默认提示" />
      <Input status="success" placeholder="成功状态" tips="校验通过" />
      <Input status="warning" placeholder="警告状态" tips="请注意" />
      <Input status="error" placeholder="错误状态" tips="输入有误" />
    </div>
  ),
};

export const Borderless: Story = {
  args: {
    borderless: true,
    placeholder: '无边框模式',
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    value: '禁用状态',
  },
};

export const ReadOnly: Story = {
  args: {
    readOnly: true,
    value: '只读状态',
  },
};

export const ShowLimitNumber: Story = {
  render: function LimitStory() {
    const [value, setValue] = useState('');
    return (
      <Input
        showLimitNumber
        maxlength={20}
        value={value}
        onChange={(v) => setValue(v)}
        placeholder="最多 20 个字符"
      />
    );
  },
};

export const MaxCharacter: Story = {
  render: function MaxCharStory() {
    const [value, setValue] = useState('');
    return (
      <Input
        showLimitNumber
        maxcharacter={20}
        value={value}
        onChange={(v) => setValue(v)}
        placeholder="中文计 2 个字符"
      />
    );
  },
};

export const Align: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Input align="left" defaultValue="左对齐" />
      <Input align="center" defaultValue="居中对齐" />
      <Input align="right" defaultValue="右对齐" />
    </div>
  ),
};

export const AutoWidth: Story = {
  args: {
    autoWidth: true,
    defaultValue: '自适应宽度',
    placeholder: '输入...',
  },
};

export const Password: Story = {
  args: {
    type: 'password',
    placeholder: '请输入密码',
    clearable: true,
  },
};

export const WithFormat: Story = {
  render: function FormatStory() {
    const [value, setValue] = useState('13800138000');
    return (
      <Input
        value={value}
        onChange={(v) => setValue(v.replace(/\D/g, ''))}
        format={(v) => {
          const digits = v.replace(/\D/g, '');
          if (digits.length <= 3) return digits;
          if (digits.length <= 7)
            return `${digits.slice(0, 3)} ${digits.slice(3)}`;
          return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7, 11)}`;
        }}
        placeholder="手机号格式化展示"
        maxcharacter={11}
      />
    );
  },
};

export const Controlled: Story = {
  render: function ControlledStory() {
    const [value, setValue] = useState('');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Input
          value={value}
          onChange={(v) => setValue(v)}
          placeholder="受控输入框"
          clearable
        />
        <span style={{ fontSize: 12, color: '#666' }}>当前值: {value}</span>
      </div>
    );
  },
};

export const WithTips: Story = {
  args: {
    placeholder: '请输入邮箱',
    suffixIcon: <Info size={16} />,
    tips: '请输入有效的邮箱地址',
    status: 'default',
  },
};
