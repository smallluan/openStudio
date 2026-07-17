# UDesign - 费控高级版组件库

UI 组件库，采用 tsx + less 技术栈。

## 📦 技术栈

- **React 19** + **TypeScript**
- **Less** 样式预处理
- **Storybook** 组件文档
- **Vite** 构建工具

## 🎨 色阶系统

UDesign 提供了完整的色阶系统，包含：

### 品牌色（Brand）
- 10 级色阶，从浅到深
- 主色：`--brand-6` (#1677FF)

### 功能色（Functional）
- **成功色**：`--success-1` ~ `--success-10`
- **警告色**：`--warning-1` ~ `--warning-10`
- **错误色**：`--error-1` ~ `--error-10`
- **信息色**：`--info-1` ~ `--info-10`

### 中性色（Neutral）
- 12 级灰度色阶
- 从纯白到纯黑

### 语义色（Semantic）
- 文本颜色：`--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-disabled`
- 背景色：`--bg-base`, `--bg-container`, `--bg-elevated`, `--bg-layout`
- 边框色：`--border-color`, `--border-color-light`, `--border-color-dark`

### 其他设计令牌
- 间距（Spacing）
- 圆角（Border Radius）
- 阴影（Shadow）
- 字体（Typography）
- 动效（Motion）

## 🚀 使用方式

### 安装依赖

```bash
cd src/packages/udesign
pnpm install
```

### 启动 Storybook

```bash
pnpm storybook
```

Storybook 将在 `http://localhost:6060` 启动。

### 在组件中使用 Less 变量

```tsx
import './Component.less';

// 在 Less 文件中
.component {
  color: @brand-6;
  background: @bg-base;
  border-radius: @border-radius-base;
}
```

### 在组件中使用 CSS 变量

```tsx
import '@open-studio/udesign/src/styles/css-variables.css';

// 在组件中
<div style={{ color: 'var(--brand-6)' }}>
  使用 CSS 变量
</div>
```

## 📁 目录结构

```
udesign/
├── .storybook/          # Storybook 配置
│   ├── main.ts         # 主配置
│   └── preview.ts      # 预览配置
├── src/
│   ├── components/     # 组件目录
│   │   └── ColorPalette/  # 色阶展示组件
│   │       ├── index.tsx
│   │       ├── index.less
│   │       └── ColorPalette.stories.tsx
│   ├── styles/         # 样式文件
│   │   ├── variables.less      # Less 变量定义
│   │   ├── css-variables.css   # CSS 变量定义
│   │   └── index.less          # 样式入口
│   └── index.ts        # 包入口
├── package.json
└── tsconfig.json
```

## 🎯 开发规范

### 组件结构

每个组件应包含：
- `index.tsx` - 组件实现
- `index.less` - 组件样式
- `ComponentName.stories.tsx` - Storybook stories

### 命名规范

- 组件名：PascalCase（如 `Button`、`ColorPalette`）
- 样式类名：kebab-case（如 `.color-palette`、`.color-swatch`）
- Less 变量：kebab-case（如 `@brand-6`、`@spacing-lg`）
- CSS 变量：kebab-case（如 `--brand-6`、`--spacing-lg`）

### 样式规范

- 优先使用 Less 变量
- 需要动态切换主题时使用 CSS 变量
- 避免硬编码颜色值
- 使用语义化变量（如 `@text-primary` 而非 `@neutral-10`）

## 📝 添加新组件

1. 在 `src/components/` 下创建组件目录
2. 创建 `index.tsx`、`index.less`、`ComponentName.stories.tsx`
3. 在 `src/index.ts` 中导出组件

```tsx
// src/components/Button/index.tsx
import React from 'react';
import './index.less';

export interface ButtonProps {
  children: React.ReactNode;
  type?: 'primary' | 'default';
  onClick?: () => void;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  type = 'default',
  onClick 
}) => {
  return (
    <button 
      className={`udesign-button udesign-button--${type}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
};
```

## 🔧 配置说明

### TypeScript 配置

- 目标：ES2020
- 模块：ESNext
- JSX：react-jsx
- 严格模式：启用

### Vite 配置

- Less 支持已启用
- CSS 预处理器选项已配置

### Storybook 配置

- 端口：6060
- Stories 路径：`../src/**/*.stories.@(js|jsx|mjs|ts|tsx)`
- 插件：essentials、interactions、links

## 📌 待办事项

- [ ] 添加 Button 组件
- [ ] 添加 Input 组件
- [ ] 添加 Form 组件
- [ ] 添加 Table 组件
- [ ] 添加 Modal 组件
- [ ] 添加 Toast 组件
- [ ] 暗色主题支持
- [ ] 国际化支持
- [ ] 单元测试

## 📄 许可证

MIT
