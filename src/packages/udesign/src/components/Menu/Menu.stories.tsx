import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Button from '../Button';
import Menu from './index';

const HomeIcon = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden>
    <path
      d="M2.5 6.5 8 2l5.5 4.5V13a1 1 0 0 1-1 1h-3V10H6.5v4h-3a1 1 0 0 1-1-1V6.5Z"
      fill="currentColor"
    />
  </svg>
);

const GridIcon = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden>
    <path
      d="M2 2h5v5H2V2Zm7 0h5v5H9V2ZM2 9h5v5H2V9Zm7 0h5v5H9V9Z"
      fill="currentColor"
    />
  </svg>
);

const UserIcon = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden>
    <path
      d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 14a5 5 0 0 1 10 0H3Z"
      fill="currentColor"
    />
  </svg>
);

const meta = {
  title: 'UDesign/Menu',
  component: Menu,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const VerticalMenu: Story = {
  render: () => (
    <div style={{ display: 'flex', height: 480 }}>
      <Menu
        logo={<span>UDesign</span>}
        defaultValue="dashboard"
        operations={<Button size="small">设置</Button>}
      >
        <Menu.MenuItem value="dashboard" icon={<HomeIcon />}>
          仪表盘
        </Menu.MenuItem>
        <Menu.Submenu value="components" title="组件" icon={<GridIcon />}>
          <Menu.MenuItem value="button">Button</Menu.MenuItem>
          <Menu.MenuItem value="input">Input</Menu.MenuItem>
          <Menu.Submenu value="feedback" title="反馈">
            <Menu.MenuItem value="popup">Popup</Menu.MenuItem>
            <Menu.MenuItem value="switch">Switch</Menu.MenuItem>
          </Menu.Submenu>
        </Menu.Submenu>
        <Menu.MenuGroup title="账户">
          <Menu.MenuItem value="profile" icon={<UserIcon />}>
            个人中心
          </Menu.MenuItem>
        </Menu.MenuGroup>
      </Menu>
      <div style={{ flex: 1, padding: 24 }}>内容区域</div>
    </div>
  ),
};

export const CollapsedMenu: Story = {
  render: () => (
    <div style={{ display: 'flex', height: 480 }}>
      <Menu collapsed defaultValue="dashboard" width={['232px', '64px']}>
        <Menu.MenuItem value="dashboard" icon={<HomeIcon />}>
          仪表盘
        </Menu.MenuItem>
        <Menu.MenuItem value="profile" icon={<UserIcon />}>
          个人中心
        </Menu.MenuItem>
      </Menu>
      <div style={{ flex: 1, padding: 24 }}>收起后悬停显示 Tooltip</div>
    </div>
  ),
};

export const HeadMenuStory: Story = {
  name: 'HeadMenu',
  render: () => (
    <Menu.HeadMenu
      logo={<span>UDesign</span>}
      defaultValue="home"
      operations={<Button size="small">登录</Button>}
    >
      <Menu.MenuItem value="home">首页</Menu.MenuItem>
      <Menu.Submenu value="docs" title="文档">
        <Menu.MenuItem value="guide">快速开始</Menu.MenuItem>
        <Menu.MenuItem value="api">API</Menu.MenuItem>
      </Menu.Submenu>
      <Menu.MenuItem value="about">关于</Menu.MenuItem>
    </Menu.HeadMenu>
  ),
};

export const PopupExpand: Story = {
  render: () => {
    const [expanded, setExpanded] = useState<Array<string | number>>([]);
    return (
      <Menu.HeadMenu
        expandType="popup"
        expanded={expanded}
        onExpand={setExpanded}
        defaultValue="home"
      >
        <Menu.MenuItem value="home">首页</Menu.MenuItem>
        <Menu.Submenu value="products" title="产品">
          <Menu.MenuItem value="design">设计</Menu.MenuItem>
          <Menu.MenuItem value="dev">开发</Menu.MenuItem>
        </Menu.Submenu>
      </Menu.HeadMenu>
    );
  },
};

export const DarkTheme: Story = {
  render: () => (
    <div style={{ background: '#141414' }}>
      <Menu theme="dark" defaultValue="dashboard">
        <Menu.MenuItem value="dashboard" icon={<HomeIcon />}>
          仪表盘
        </Menu.MenuItem>
        <Menu.MenuItem value="profile" icon={<UserIcon />}>
          个人中心
        </Menu.MenuItem>
      </Menu>
    </div>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = useState<string | number>('dashboard');
    const [expanded, setExpanded] = useState<Array<string | number>>(['components']);

    return (
      <div style={{ display: 'flex', height: 480 }}>
        <Menu
          value={value}
          onChange={setValue}
          expanded={expanded}
          onExpand={setExpanded}
          expandMutex
        >
          <Menu.MenuItem value="dashboard" icon={<HomeIcon />}>
            仪表盘
          </Menu.MenuItem>
          <Menu.Submenu value="components" title="组件" icon={<GridIcon />}>
            <Menu.MenuItem value="button">Button</Menu.MenuItem>
            <Menu.MenuItem value="input">Input</Menu.MenuItem>
          </Menu.Submenu>
          <Menu.Submenu value="settings" title="设置" icon={<UserIcon />}>
            <Menu.MenuItem value="profile">个人中心</Menu.MenuItem>
          </Menu.Submenu>
        </Menu>
        <div style={{ flex: 1, padding: 24 }}>
          <p>当前选中：{String(value)}</p>
          <p>展开项：{expanded.join(', ')}</p>
        </div>
      </div>
    );
  },
};
