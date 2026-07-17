# TDesign 替换计划（Open Studio）

## 目标

- 使用 `tdesign-react` 作为基础组件库，减少 `@open-studio/udesign` 的维护成本。
- 保留现有 `src/ui` 作为兼容适配层，避免业务页面一次性大改。
- 分阶段替换，确保每阶段都可回归和发布。

## 当前状态（已完成）

- 已安装依赖：
  - `tdesign-react`
  - `tdesign-icons-react`
- 现有项目主要使用的 `udesign` 组件集中在：
  - `Button`
  - `Input`
  - `Switch`
  - `Menu`

## 总体策略

- **优先改 `src/ui` 适配层，再改业务页面**。
- 业务页面尽量只依赖 `src/ui`，不再直接依赖 `@open-studio/udesign`。
- 对高自定义交互（如液态动画、复杂浮层）保留自研实现，仅替换底层按钮/输入等基础控件。

## 分阶段执行

### Phase 0：基线准备（0.5 天）

- 在应用入口引入 TDesign 基础样式（建议在全局入口一次性引入）。
- 新建/调整 `src/ui` 组件映射规范：
  - `src/ui/Button` -> TDesign `Button`
  - `src/ui/TextField` -> TDesign `Input`
  - `src/ui/Select` -> TDesign `Select`（保留当前自定义浮层可延后）
  - `src/ui/Modal` -> TDesign `Dialog`（或继续保留现实现）
- 定义统一 token 覆盖策略（颜色、圆角、阴影、间距）以贴近现有视觉风格。

### Phase 1：低风险替换（1-2 天）

- 仅替换直接使用 `@open-studio/udesign` 的简单页面组件，优先：
  - `Button` 直出场景
  - `Input` 搜索框/过滤框
  - `Switch` 设置项开关
- 建议先从这些模块开始：
  - `src/components/settings/*`
  - `src/components/dev/*`
  - `src/components/shell/*` 中非复杂交互区域

验收标准：

- 页面功能与交互一致（点击、禁用、加载态、键盘操作）。
- 无明显视觉回退（按钮尺寸、对齐、颜色状态）。

### Phase 2：中风险替换（2-4 天）

- 迁移 `Menu` 相关页面（如设置页左侧导航、主导航）。
- 迁移复合控件中对 `Button/Input` 的内部依赖，但保持 API 不变：
  - `src/ui/Transfer.jsx`
  - `src/ui/Checkbox.jsx`
  - `src/ui/Avatar.jsx`
- 对 `ChatLab` 相关区域按子模块逐步切换，避免一次性全量替换。

验收标准：

- 导航/菜单的选中态、展开态、快捷键行为一致。
- 复合控件在大数据量/长列表场景下无性能明显退化。

### Phase 3：高风险区域与收尾（2-3 天）

- 处理高度自定义组件（建议保留结构，仅替换最底层基础控件）：
  - `src/ui/FluidConfirmDialog.jsx`
  - `src/ui/Modal.jsx`
  - `src/ui/Select.jsx`（若保留自定义浮层，可只替换触发按钮与输入）
- 全仓扫描并移除 `@open-studio/udesign` 的直接引用。
- 当无引用后，执行：
  - 从根包移除 `@open-studio/udesign` 依赖
  - 评估是否保留 `src/packages/udesign`（若不再维护可冻结或删除）

验收标准：

- `rg "@open-studio/udesign" src` 无业务代码引用。
- 核心路径（聊天、设置、管理页）回归通过。

## 组件映射建议（初版）

- `udesign.Button` -> `tdesign-react` `Button`
- `udesign.Input` -> `tdesign-react` `Input`
- `udesign.Switch` -> `tdesign-react` `Switch`
- `udesign.Menu` -> `tdesign-react` `Menu`

注意事项：

- 事件签名可能不同（例如 `onChange` 参数结构），优先在 `src/ui` 层做兼容转换。
- 尺寸与主题命名存在差异（`size`、`theme`、`variant`），先建立映射表再批量替换。

## 建议执行顺序（可直接照做）

1. 全局引入 TDesign 样式 + 建立 `src/ui` 映射层。
2. 替换 `settings/dev/shell` 的简单组件引用。
3. 替换 `Menu` 与复合控件内部依赖。
4. 处理 `ChatLab` 和液态动效相关高自定义组件。
5. 清理 `@open-studio/udesign` 引用并下线旧包。

## 风险与规避

- 风险：交互事件签名不兼容  
  规避：统一在 `src/ui` 包一层 adapter，业务层不直接处理库差异。

- 风险：视觉细节回退  
  规避：先统一 token 和样式变量，再做批量替换。

- 风险：一次性改动过大难回滚  
  规避：按模块拆分 PR，每个 PR 都可独立发布。
