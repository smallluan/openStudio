# UDesign

Open Studio 组件库，技术栈：React 19 + TypeScript + Less + Storybook。

## 快速开始

在仓库根目录安装依赖（pnpm workspace）：

```bash
pnpm install
```

启动 Storybook：

```bash
pnpm --filter @open-studio/udesign storybook
```

打开 http://localhost:6060

类型检查：

```bash
pnpm --filter @open-studio/udesign typecheck
```

## 使用

```tsx
import { Button } from '@open-studio/udesign';
import '@open-studio/udesign/styles/css-variables.css';

export function Demo() {
  return <Button theme="primary">确认</Button>;
}
```

Less 变量（组件样式内）：

```less
@import '@open-studio/udesign/styles/variables.less';

.demo {
  color: @brand-6;
  border-radius: @border-radius-base;
}
```

## 目录结构

```
udesign/
├── .storybook/                 # Storybook 配置
├── src/
│   ├── components/
│   │   ├── Button/
│   │   └── ColorPalette/
│   ├── styles/
│   │   ├── variables.less      # Less 设计令牌
│   │   ├── css-variables.css   # CSS 变量
│   │   └── index.less
│   ├── vite-env.d.ts
│   └── index.ts
├── package.json
├── tsconfig.json               # 源码类型检查
└── tsconfig.storybook.json     # Storybook 类型检查
```

## 组件规范

每个组件目录包含：

- `index.tsx` — 实现
- `index.less` — 样式
- `type.ts` — 类型（可选，复杂组件推荐）
- `ComponentName.stories.tsx` — Storybook

命名：

- 组件：PascalCase（`Button`）
- 样式类：BEM（`.udesign-btn`、`.udesign-btn--theme-primary`）
- Less / CSS 变量：kebab-case（`@brand-6`、`--brand-6`）

## 色阶

| 类别 | 变量 |
|------|------|
| 品牌色 | `--brand-1` ~ `--brand-10`（主色 `--brand-6`） |
| 成功 / 警告 / 错误 / 信息 | `--success-*` / `--warning-*` / `--error-*` / `--info-*` |
| 中性色 | `--neutral-1` ~ `--neutral-12` |
| 语义色 | `--text-primary`、`--bg-base`、`--border-color` 等 |

## 许可证

MIT
