# Open Studio 前端开发规范（Agent 指引）

本文档供 AI Agent 与开发者在 Open Studio 前端开发时遵循，确保 UI 组件、主题与样式体系统一。

## 核心原则

**优先使用 `@open-studio/udesign` 组件库，避免在业务代码中直接用 Tailwind 写交互组件样式。**

原因：

1. **避免 Tailwind 样式污染**：在 JSX 里堆叠大量 `className`（如 `rounded-lg px-3 py-1.5 bg-[var(--os-accent)] hover:brightness-110`）会导致同一类控件在不同页面外观不一致，难以全局调整。
2. **主题化统一治理**：udesign 通过 Less 变量与 CSS 变量（`--brand-*`、`--text-primary` 等）集中管理颜色、圆角、动效；改一处即可全局生效。
3. **可维护性**：组件行为（loading、disabled、尺寸、变体）由组件 API 表达，而不是散落在 class 字符串里。

## 组件选用优先级

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `@open-studio/udesign` | 首选。已有 Button、Switch、Popup 等 |
| 2 | `src/ui/` 业务封装 | 仅在 udesign 暂无对应能力时封装，内部仍应优先组合 udesign 组件 |
| 3 | 原生 HTML + Tailwind | **禁止**用于按钮、开关、弹层等标准交互控件；布局类 Tailwind（flex、grid、gap、overflow 等）仍可使用 |

## 引入方式

在应用入口已加载 udesign 设计令牌：

```jsx
import "@open-studio/udesign/styles/css-variables.css";
```

业务组件中按需引入：

```jsx
import { Button } from "@open-studio/udesign";

<Button theme="primary" variant="base" size="medium">
  确认
</Button>
```

本地开发 / Storybook 查看组件文档：

```bash
pnpm storybook:udesign
```

## Button 使用约定

- **禁止**使用原生 `<button>`，统一使用 udesign `Button`。
- 用 `theme` / `variant` / `size` / `shape` 表达语义，而不是 Tailwind 颜色类：
  - 主操作：`theme="primary"` `variant="base"`
  - 次要 / 取消：`variant="outline"` 或 `variant="text"`
  - 危险操作：`theme="danger"`
  - 纯图标：`shape="square"` 或 `shape="circle"` + `size="small"`
  - 加载中：`loading`
- `className` 仅用于**布局**（如 `w-full`、`shrink-0`）或**页面级 BEM 钩子**（如 `os-titlebar__btn`），不要用来重新定义背景色、边框、hover 等视觉样式。
- 需要链接行为时使用 `href`；需要非 button 标签时使用 `tag`（如 `tag="div"` 配合 Popup）。

## 其他 udesign 组件

- **Switch**：统一使用 `@open-studio/udesign` 的 `Switch`（`value` + `onChange`），禁止使用 `src/ui/Switch.jsx`（已移除）。
- **Popup**：浮层、下拉、Popover 优先 udesign `Popup`。
- **缺失组件**：先在 `src/packages/udesign/src/components/` 新增组件（含 Storybook），再在业务中引用；不要在业务层用 Tailwind 临时实现一套。

## Tailwind 允许范围

| 允许 | 不允许（应用 udesign 替代） |
|------|----------------------------|
| 页面布局：`flex`、`grid`、`gap`、`min-h-0` | 按钮：`bg-*`、`rounded-*`、`hover:*` 组合 |
| 间距：`p-*`、`m-*`（容器级） | 开关、Checkbox 视觉样式 |
| 文本排版：`text-sm`、`truncate` | 模态框底部操作按钮样式 |
| 响应式：`sm:`、`md:` 布局断点 | 重复出现的控件皮肤 |

## 新增 / 修改 UI 时的检查清单

- [ ] 是否使用了 udesign 已有组件？
- [ ] 按钮是否通过 `theme` / `variant` 而非 Tailwind 配色？
- [ ] 是否引入了 `@open-studio/udesign/styles/css-variables.css`（入口已全局引入，子包无需重复）？
- [ ] 新交互控件是否考虑在 udesign 中实现并补 Storybook？
- [ ] 是否避免复制粘贴 Tailwind 按钮样式到其他文件？

## 目录参考

```
src/packages/udesign/     # 组件库（Less + TS + Storybook）
src/ui/                   # 应用级 UI 封装（逐步收敛到 udesign）
src/styles/theme.css      # 应用主题变量（与 udesign 令牌对齐）
```

## 相关命令

```bash
pnpm storybook:udesign          # 启动 udesign Storybook
pnpm typecheck:udesign          # udesign 类型检查
pnpm run build                  # 验证主应用构建
```
