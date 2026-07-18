# 右侧边栏 / 网页漫游自动化（native tool `sidebar_action`）

Open Studio 可通过 Chat Lab 右侧边栏预览或网页漫游主视口打开网页，并与页面交互。本文档描述 **读取** 与 **控制** 两套机制。

控制路径为 **OpenClaw 原生工具** `sidebar_action`：模型在同一轮 `chat.send` 内发起 tool call → gateway 暂停 → Electron loopback 执行 DOM 操作 → 回传 observation → 模型继续。

相关独立工具（不混入 steps）：

- [`sidebar_debug`](./sidebar-preview-tools.md) — console / 网络录制与按需拉取  
- [`sidebar_screenshot`](./sidebar-preview-tools.md) — 视口截图

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

### 1.2 控制（主动）— native `sidebar_action`

```
模型 tool call: sidebar_action({ steps: [...] })  ≤5
  → OpenClaw execute 等待 HTTP loopback
  → Electron bridge → 渲染进程 runSidebarAutomation
  → 抓取最新 DOM / 元素清单
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

### 2.1 定位（必须基于观测）

| 字段 | 说明 |
|------|------|
| `ref` | **推荐**。来自元素清单 / `observation.elements`，如 `e3` |
| `selector` | CSS 选择器，支持 `:contains('文字')` |
| `label` / `placeholder` / `title` | 按可见文本 / 属性匹配 |
| `parentSelector` | 限定搜索范围 |

**禁止**臆造自然语言字段（如 `"target":"包含「毕导」的视频卡片"`）。

### 2.2 返回

```json
{
  "ok": true,
  "steps": [{ "ok": true, "action": "click", "...": "..." }],
  "observation": {
    "url": "...",
    "title": "...",
    "text": "...",
    "elements": [{ "ref": "e1", "selector": "...", "name": "...", "role": "..." }]
  },
  "hint": "..."
}
```

---

## 3. 可用 action

基础：`focus` `type` `type_chars` `click` `blur` `press` `wait` `scroll` `snapshot` `navigate` `reload`（`refresh` 同义；可选 `ms` 等待加载）  
鼠标：`mousedown` `mouseup` `pointerdown` `pointerup` `mousemove` `pointermove` `hover` `dblclick` `rightclick` `contextmenu` `drag`

首屏网络/日志录制请优先用 [`sidebar_debug`](./sidebar-preview-tools.md) 的 `start` + `reload: true`，不要只靠 `sidebar_action` reload。

实现：`src/chat/chatLabPreviewAutomation.js`。
