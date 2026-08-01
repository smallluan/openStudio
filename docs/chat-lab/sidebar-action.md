# 右侧边栏 / 网页漫游自动化（native tool `sidebar_action`）

Open Studio 可通过 Chat Lab 右侧边栏预览或网页漫游主视口打开网页，并与页面交互。本文档描述 **读取** 与 **控制** 两套机制。

控制路径为 **OpenClaw 原生工具** `sidebar_action`：模型在同一轮 `chat.send` 内发起 tool call → gateway 暂停 → Electron loopback 执行 DOM 操作 → 回传 observation → 模型继续。

相关独立工具（不混入 steps）：

- [`sidebar_debug`](./sidebar-preview-tools.md) — console / 网络录制与按需拉取  
- [`sidebar_debugger`](./sidebar-debugger.md) — JS 断点、暂停检查变量  
- [`sidebar_screenshot`](./sidebar-preview-tools.md) — 视口截图  
- [`browser-observation-prune.md`](./browser-observation-prune.md) — 换页后剥离旧 DOM 的上下文策略

---

## 1. 通信方式总览

### 1.1 读取（被动）

每次用户发送消息时，若预览区有打开的网页，系统会注入：

1. **页面可见文字**快照  
2. **可交互元素清单**（`ref` / `selector` / `name` / `role` …）

实现：`src/chat/chatLabPreviewSnapshot.js` → `captureSidebarPreviewSnapshot`  
- 读取 DOM，不是截图 / OCR  
- 支持同域 iframe；Canvas / 在线表格类页面往往读不全  
- 有快照时 AI 应优先使用快照，不要用 web fetch 重复抓同一 URL

普通对话默认保持完整快照。selector-only skill 可以在描述中加入：

```text
[openstudio:browser-dom=selector-only]
```

这会让首轮被动上下文只注入 URL/title；模型随后通过 `browser_action` 主动查询需要的 DOM。

### 1.2 控制（主动）— native `sidebar_action`

```
模型 tool call: sidebar_action({ steps: [...] })  ≤5
  → OpenClaw execute 等待 HTTP loopback
  → Electron bridge → 渲染进程 runSidebarAutomation
  → 按 domRead 分层读取最新 DOM / 元素清单
  → jsonResult({ ok, steps, observation })
  → 同轮继续：再 call，或自然语言结束
```

| 规则 | 值 |
|------|-----|
| 每批最多步数 | 5（`SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN`） |
| 步间间隔 | 约 500ms |
| 调用方式 | OpenClaw 工具 `sidebar_action`（出现在 `tool_trace`） |
| 失败行为 | 默认 `stopOnFailure: true`，结果仍含 observation 以便重试 |

### 1.3 架构要点

| 组件 | 路径 |
|------|------|
| OpenClaw 工具注入 | `patches/openclaw@2026.6.1.patch`（`pnpm.patchedDependencies`） |
| Gateway 环境变量 | `OPEN_STUDIO_SIDEBAR_TOOL_URL` / `OPEN_STUDIO_SIDEBAR_TOOL_TOKEN` |
| Loopback HTTP | `lib/sidebar-action-tool-bridge.cjs`（`127.0.0.1:19111`） |
| 渲染执行 | `ChatLabPreviewContext.executeSidebarActionTool` |

遗留的 ```sidebar-action``` 围栏 / `[sidebar-automation-continue]` 续轮已降级，不再作为主路径。

---

## 2. 工具参数

```json
{
  "steps": [
    { "action": "click", "ref": "e12" }
  ]
}
```

### 2.1 DOM 读取层级

`browser_action` 支持请求级 `domRead`，默认是 `auto`：

| 层级 | 行为 |
|------|------|
| `auto` | 全是明确 selector 时跳过全页扫描；使用 ref/模糊定位时自动升到 `inventory` 或 `full` |
| `none` / `metadata` | 只返回 URL/title/pageGeneration，不返回正文或元素清单 |
| `target` | 只查询本次请求提供的 selector，不扫描无关页面 |
| `inventory` | 只返回交互元素清单，不读取正文 |
| `full` | 返回正文、iframe 文本、canvas 提示和元素清单 |

selector-only 填单示例：

```json
{
  "domRead": "auto",
  "steps": [
    { "action": "type", "selector": "input[name='title']", "text": "示例工单" },
    { "action": "click", "selector": "button[type='submit']" }
  ]
}
```

需要主动确认某个 selector 时使用 `query`（`inspect` 同义），只返回小型目标结果：

```json
{
  "domRead": "target",
  "steps": [
    { "action": "query", "selector": "button[data-testid='submit']" }
  ]
}
```

### 2.2 定位（必须基于观测）

| 字段 | 说明 |
|------|------|
| `ref` | **推荐**。来自元素清单 / `observation.elements`，如 `e3` |
| `selector` | CSS 选择器，支持 `:contains('文字')` |
| `label` / `placeholder` / `title` | 按可见文本 / 属性匹配 |
| `parentSelector` | 限定搜索范围 |

**禁止**臆造自然语言字段（如 `"target":"包含「毕导」的视频卡片"`）。

### 2.3 返回

```json
{
  "ok": true,
  "steps": [{ "ok": true, "action": "click", "...": "..." }],
  "observation": {
    "url": "...",
    "title": "...",
    "pageGeneration": 2,
    "pageChanged": true,
    "domRead": "none",
    "text": "...",
    "elements": [{ "ref": "e1", "selector": "...", "name": "...", "role": "..." }]
  },
  "hint": "..."
}
```

可选参数：

| 字段 | 说明 |
|------|------|
| `retainPriorPageDom` | 默认 `false`。为 `true` 时，组 prompt 时保留**上一页**（`pageGeneration - 1`）的 DOM 清单，用于少见的跨页对照 |

### 2.4 换页后的上下文剥离（DOM vs 轨迹）

**问题**：同轮多次 `browser_action` 会把每次的 `observation.elements` / `text` 留在 gateway 会话里；换页后旧 `ref`（`e1`…）不仅浪费 token，还会误导模型。

**策略**（默认）：

| 保留 | 剥离 |
|------|------|
| `steps` 执行结果、`ok` / `error` | 旧 observation 的 `elements` |
| `url` / `title` / `pageGeneration` | 旧 observation 的 `text` |
| **最新一次** observation 的完整 DOM | — |

实现要点：

1. 渲染进程在每次 observation 上打 `pageGeneration`（URL 变化或 `navigate` / `reload` / `refresh` 时递增）— `lib/browser-observation-prune.cjs` + `ChatLabPreviewContext`
2. OpenClaw 在组 LLM prompt 时（`truncateOversizedToolResultsInMessages`）调用 `openStudioPruneStaleBrowserActionDom`，只保留最新 observation 的 DOM；更早的标记 `domStripped: true` 并留下 `elementCount` / `note`
3. **不改写** session 落盘原文，只影响发往模型的 in-memory 历史
4. 用户发送时的 `previewContext` 本来就是 volatile、只挂在最新 user turn，不受影响

例外：`retainPriorPageDom: true` 时额外保留上一 `pageGeneration` 的完整 DOM。

相关：`scripts/patch-openclaw-browser-observation-prune.mjs`、`docs` 本节。

---

## 3. 可用 action

基础：`focus` `type` `type_chars` `click` `blur` `press` `wait` `scroll` `snapshot` `navigate` `reload`（`refresh` 同义；可选 `ms` 等待加载）  
文件：`set_files`（`upload` / `attach` 同义）— 通过 CDP 设置 `input[type=file]`，**不要**点击会弹出系统文件选择框的按钮  
鼠标：`mousedown` `mouseup` `pointerdown` `pointerup` `mousemove` `pointermove` `hover` `dblclick` `rightclick` `contextmenu` `drag`

### 3.1 上传文件（`set_files`）

原生 OS 文件对话框无法被自动化操作。应使用：

```json
{
  "action": "set_files",
  "ref": "e12",
  "files": ["D:/path/to/document.pdf"]
}
```

- `files`：本机**绝对路径**数组，文件必须存在  
- `ref` / `selector` / `label`：指向 `input[type=file]`，或指向上传按钮（会在附近查找隐藏的 file input）  
- 设置后会自动触发 `input` / `change` 事件

首屏网络/日志录制请优先用 [`sidebar_debug`](./sidebar-preview-tools.md) 的 `start` + `reload: true`，不要只靠 `sidebar_action` reload。

实现：`src/chat/chatLabPreviewAutomation.js`。
