# Open Studio 前端开发规范（Agent 指引）

本文档供 AI Agent 与开发者在 Open Studio 前端开发时遵循，确保 UI 组件、主题与样式体系统一。

## 核心原则

**优先使用 `tdesign-react` 组件库，避免在业务代码中直接用 Tailwind 写交互组件样式。**

原因：

1. **避免样式分叉**：在 JSX 中大量堆叠 `className` 会导致同类控件在不同页面外观不一致，难以统一治理。
2. **主题化统一治理**：TDesign + 全局 CSS 变量便于集中管理颜色、圆角、动效；改一处可全局生效。
3. **可维护性**：组件行为（loading、disabled、尺寸、变体）由组件 API 表达，而不是散落在 class 字符串里。

## 组件选用优先级

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `tdesign-react` | 首选。Button、Select、Switch、Popup、Menu 等基础控件 |
| 2 | `src/ui/` 业务封装 | 仅在 TDesign 暂无对应能力时封装，内部仍应优先组合 TDesign |
| 3 | 原生 HTML + Tailwind | 禁止用于按钮、开关、弹层等标准交互控件；布局类 Tailwind（flex、grid、gap、overflow 等）仍可使用 |

## 引入方式

在组件中按需引入：

```jsx
import { Button, Select, Switch } from "tdesign-react";
```

业务示例：

```jsx
<Button theme="primary" variant="base" size="medium">
  确认
</Button>
```

## Button 使用约定

- 禁止使用原生 `<button>` 实现标准业务按钮，统一使用 TDesign `Button`。
- 用 `theme` / `variant` / `size` / `shape` 表达语义，而不是 Tailwind 颜色类：
  - 主操作：`theme="primary"` `variant="base"`
  - 次要 / 取消：`variant="outline"` 或 `variant="text"`
  - 危险操作：`theme="danger"`
  - 纯图标：`shape="square"` 或 `shape="circle"` + `size="small"`
  - 加载中：`loading`
- `className` 仅用于布局（如 `w-full`、`shrink-0`）或页面级 BEM 钩子，不要重定义按钮皮肤。

## 其他组件约定

- **Select**：默认使用 `tdesign-react` 的 `Select`，自定义触发器仅用于强业务场景。
- **Switch**：统一使用 `tdesign-react` 的 `Switch`。
- **Popup / Dialog**：浮层、下拉、Popover、确认弹窗优先使用 TDesign 体系。
- **缺失组件**：优先在 `src/ui/` 中封装适配层，不在业务层直接临时拼一套样式。

## Tailwind 允许范围

| 允许 | 不允许（应用 TDesign 替代） |
|------|------------------------------|
| 页面布局：`flex`、`grid`、`gap`、`min-h-0` | 按钮皮肤：`bg-*`、`rounded-*`、`hover:*` 组合 |
| 容器间距：`p-*`、`m-*` | 开关、Checkbox、Select 的视觉样式重造 |
| 文本排版：`text-sm`、`truncate` | 模态框操作区按钮样式重造 |
| 响应式布局断点：`sm:`、`md:` | 重复出现的控件皮肤 |

## 新增 / 修改 UI 时检查清单

- [ ] 是否优先使用了 `tdesign-react` 组件？
- [ ] 是否通过组件 API（theme/variant/size）表达视觉与交互语义？
- [ ] 是否避免在业务页面直接手写一套交互控件皮肤？
- [ ] 自定义组件是否仅承载业务差异，而不是重复实现基础组件能力？

## 目录参考

```text
src/ui/                   # 应用级 UI 封装（基于 TDesign 适配）
src/styles/theme.css      # 应用主题变量（与 TDesign 主题协同）
```

## 相关命令

```bash
pnpm run build                  # 验证主应用构建
```
