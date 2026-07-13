# 右侧边栏自动化协议（sidebar-action）

Open Studio Chat Lab 可通过右侧边栏预览（sidebar preview）打开网页，并与页面交互。本文档描述 **读取** 与 **控制** 两套机制，以及 `sidebar-action` 协议的全部 action 与参数。

---

## 1. 通信方式总览

### 1.1 读取（被动）

每次用户发送消息时，若右侧边栏有打开的网页，系统会把 **页面文字快照** 注入到 AI 上下文（`sidebarPreviewContext`）：

- 读取的是 DOM **可见文字**，不是截图 / OCR
- 实现：`src/chat/chatLabPreviewSnapshot.js` → `captureSidebarPreviewSnapshot`
- 支持同域 iframe；Canvas / 在线表格类页面往往读不全
- 有快照时 AI 应优先使用快照，不要用 web fetch 重复抓同一 URL

### 1.2 控制（主动）

AI 在 **助手回复正文** 中输出 `sidebar-action` 代码块（JSON 步骤数组），由客户端在右侧 Electron webview 内顺序执行：

```
ChatLabPage
  └─ ChatLabSidebarActionRunner     监听助手消息，提取步骤
       └─ ChatLabPreviewContext     runSidebarAutomation()
            └─ chatLabPreviewAutomation.js   注入 JS 逐步执行
```

执行结果通过 `[sidebar-automation-result]` 内部消息回传给 AI；失败时可收到 `[sidebar-automation-retry]` 要求修正后 **从第 1 步重新输出完整数组**。

### 1.3 打开网页

| 方式 | 说明 |
|------|------|
| Markdown 链接 | 回复中写 `[标题](https://…)`，在用户设置「链接在右侧边栏打开」时自动加载 |
| `navigate` action | 程序化跳转到指定 URL |

---

## 2. 协议格式

### 2.1 代码块

在助手回复正文中写：

````markdown
```sidebar-action
[
  {"action": "click", "selector": "button.submit"},
  {"action": "wait", "ms": 500}
]
```
````

### 2.2 约束

| 规则 | 值 |
|------|-----|
| 每轮最多步数 | 100（`SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN`） |
| 步间间隔 | 约 500ms（`SIDEBAR_AUTOMATION_STEP_INTERVAL_MS`） |
| 输出位置 | **必须**写在助手回复正文，不要塞进网关工具参数 |
| 分批 | **禁止**拆成多条回复（「第 1 步」「第 2 步」）；一次输出全部步骤 |
| 失败行为 | 默认 `stopOnFailure: true`，某步失败后暂停 |
| 可重试错误 | `element_not_found` 会自动重试若干次（800 / 1200 / 1800ms） |

### 2.3 步骤对象通用字段

```ts
{
  action: string;           // 必填
  selector?: string;        // CSS 选择器，支持 :contains('文字')
  parentSelector?: string;  // 限定搜索范围
  label?: string;           // 按可见文本匹配
  placeholder?: string;     // 按 placeholder 匹配输入框
  title?: string;           // 按 title 属性匹配
  text?: string;            // type / navigate 标题等
  scroll?: boolean;         // false 时跳过 scrollIntoView
}
```

---

## 3. 全部 action 一览

### 3.1 基础操作

| action | 说明 | 主要参数 |
|--------|------|----------|
| `click` | 点击元素 | `selector` 等定位字段；`mode: "synthetic"` 见下文 |
| `focus` | 聚焦输入框（可能先 click 再 focus） | 定位字段 |
| `blur` | 失焦并触发 change | 定位字段；无目标时用 `document.activeElement` |
| `type` | 一次性填入文本 | `text` + 定位字段 |
| `type_chars` | 逐字输入（模拟打字） | `text`, `intervalMs`（0–300ms）；或 `mode: "char"` |
| `press` | 按键 | `key`：`Enter` / `Escape` / `Tab` / 单字符 |
| `wait` | 等待 | `ms`（0–15000） |
| `scroll` | 页面纵向滚动 | `amount`（默认 480，像素） |
| `snapshot` | 抓取当前页文字快照 | 无 |
| `navigate` | 导航到 URL | `url` |

### 3.2 鼠标操作

| action | 说明 | 别名 |
|--------|------|------|
| `mousedown` | 鼠标按下（不抬起） | `pointerdown`（行为相同，均派发 Pointer + Mouse 事件） |
| `mouseup` | 鼠标抬起 | `pointerup` |
| `mousemove` | 鼠标移动 | `pointermove` |
| `hover` | 悬停（`mouseover` + `mouseenter`） | — |
| `dblclick` | 双击（完整事件链） | — |
| `rightclick` | 右键点击 | `contextmenu` |
| `drag` | 从元素拖到目标 | — |

### 3.3 `click` 的两种模式

| mode | 行为 |
|------|------|
| 默认（省略或 `native`） | 调用 DOM `el.click()` |
| `synthetic` 或 `chain` | 派发 `pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click` |

示例：

```json
{"action": "click", "selector": "button.ok", "mode": "synthetic"}
```

---

## 4. 鼠标参数

以下参数适用于 `click`、`mousedown`、`mouseup`、`mousemove`、`hover`、`dblclick`、`rightclick`、`drag` 等。

| 参数 | 类型 | 说明 |
|------|------|------|
| `button` | `0 \| 1 \| 2` | `0` 左键（默认）、`1` 中键、`2` 右键 |
| `buttons` | `number` | 按下态位掩码；`mousemove` 拖拽中常用 `1` |
| `x`, `y` | `number` | 视口绝对坐标（clientX / clientY） |
| `offsetX`, `offsetY` | `number` | 相对元素中心的偏移；未指定 `x`/`y` 时默认取元素中心 |
| `toSelector` | `string` | **仅 `drag`**：终点元素 |
| `toX`, `toY` | `number` | **仅 `drag`**：终点视口坐标 |
| `toOffsetX`, `toOffsetY` | `number` | **仅 `drag`**：相对终点元素中心的偏移 |
| `dragSteps` | `number` | **仅 `drag`**：插值步数，默认 `12` |

### 4.1 事件派发细节

- 每个鼠标 action 在 webview 内通过 `executeJavaScript` 注入执行
- 对 `mousedown` / `mouseup` / `mousemove` 等，会 **同时派发 PointerEvent 与 MouseEvent**，以兼容现代前端框架
- 坐标解析：若提供 `x`+`y` 则用绝对坐标；否则取目标元素 `getBoundingClientRect()` 中心，再加 `offsetX`/`offsetY`
- 命中检测：通过 `document.elementFromPoint(x, y)` 确定事件目标元素

### 4.2 `drag` 行为

1. 在源元素处 `mousedown`
2. 在起点与终点之间按 `dragSteps` 插值派发 `mousemove`（`buttons: 1`），每步约 16ms
3. 在终点处 `mouseup`

终点必须指定 **`toSelector`** 或 **`toX` + `toY`** 之一，否则返回 `missing_drag_target`。

---

## 5. 元素定位

### 5.1 优先级

对带定位字段的 action，`resolveTarget` 按以下顺序查找：

1. `parentSelector` 限定范围
2. `selector`（CSS；支持 `:contains('文字')` 伪选择器）
3. `title` 属性包含匹配
4. `placeholder` / `aria-placeholder` 包含匹配
5. `label`：匹配 `<label>` 关联控件或可见文本

### 5.2 选择器增强

- **Shadow DOM**：自动穿透（深度 ≤ 3）
- **iframe**：自动进入同域 iframe（深度 ≤ 3）
- **`:contains('文本')`**：在目标节点集合中按 `innerText` / `textContent` 子串匹配
- **可见性**：`display:none`、`visibility:hidden`、`opacity:0`、过小尺寸的元素会被跳过

### 5.3 可点击目标提升

`click` / `mousedown` 等会对命中元素向上查找更合适的交互节点：`button`、`a`、`role=button`、`cursor:pointer`、`onclick` 等。

---

## 6. 使用示例

### 6.1 搜索流程（基础）

```sidebar-action
[
  {"action": "click", "selector": "div[data-uba-title='menu']"},
  {"action": "wait", "ms": 500},
  {"action": "focus", "selector": "input.search-input"},
  {"action": "type", "selector": "input.search-input", "text": "关键词"},
  {"action": "press", "key": "Enter"},
  {"action": "wait", "ms": 800},
  {"action": "snapshot"}
]
```

### 6.2 手动分步拖拽

```sidebar-action
[
  {"action": "mousedown", "selector": ".slider-handle"},
  {"action": "mousemove", "x": 420, "y": 300, "buttons": 1},
  {"action": "wait", "ms": 100},
  {"action": "mouseup", "x": 420, "y": 300}
]
```

### 6.3 一键拖拽

```sidebar-action
[
  {"action": "drag", "selector": ".slider-handle", "toX": 420, "toY": 300, "dragSteps": 16}
]
```

或拖到另一个元素：

```sidebar-action
[
  {"action": "drag", "selector": ".card", "toSelector": ".drop-zone"}
]
```

### 6.4 悬停菜单 + 右键

```sidebar-action
[
  {"action": "hover", "selector": ".menu-trigger"},
  {"action": "wait", "ms": 300},
  {"action": "rightclick", "selector": ".row-item:nth-child(2)"}
]
```

### 6.5 双击

```sidebar-action
[
  {"action": "dblclick", "selector": ".file-name", "label": "report.pdf"}
]
```

### 6.6 合成点击（对依赖真实事件链的组件）

```sidebar-action
[
  {"action": "click", "selector": ".custom-button", "mode": "synthetic"}
]
```

---

## 7. 错误码

| error | 含义 |
|-------|------|
| `element_not_found` | 定位失败（会重试） |
| `target_not_found` | `drag` 的 `toSelector` 未找到 |
| `missing_drag_target` | `drag` 未提供终点 |
| `not_input` | `type` / `type_chars` 目标不是可输入元素 |
| `missing_url` | `navigate` 缺少 `url` |
| `webview_unavailable` | 右侧 webview 未就绪 |
| `unknown_action` | 不认识的 `action` |
| `no_steps` | 步骤数组为空 |
| `external_mode` | 用户设置链接在外部浏览器打开，自动化被禁用 |

---

## 8. 本地调试

1. 确保设置中链接打开方式为 **右侧边栏**（非外部浏览器）
2. 在 Chat Lab 右侧预览区底部找到 **sidebar-action 调试输入框**（`ChatLabPreviewAutomationDebugInput`）
3. 粘贴 JSON 数组或完整 `sidebar-action` 代码块，点击执行
4. 打开开发者工具查看 `[sidebar-automation-debug]` 控制台输出

---

## 9. 实现索引

| 模块 | 路径 |
|------|------|
| 步骤规范化与执行 | `src/chat/chatLabPreviewAutomation.js` |
| 消息解析 | `src/chat/chatLabSidebarActionProtocol.js` |
| 自动运行器 | `src/components/chat-lab/ChatLabSidebarActionRunner.jsx` |
| 预览上下文 API | `src/context/ChatLabPreviewContext.jsx` |
| 页面快照 | `src/chat/chatLabPreviewSnapshot.js` |
| AI 系统提示（精简版） | `src/i18n/locales/zh-CN.json` → `chatLab.sidebarAutomationPrompt` |
| 调试输入 | `src/components/chat-lab/ChatLabPreviewAutomationDebugInput.jsx` |

---

## 10. 已知限制

- 自动化仅在 **Electron webview** 中执行；纯 iframe / srcdoc 预览能力有限
- 跨域 iframe 内元素无法操作
- Canvas / 在线表格的单元格内容通常无法通过 `snapshot` 读取
- 合成鼠标事件无法 100% 复现真实用户操作；部分站点可能仍依赖原生命中测试或 OS 级输入
- 用户右键 webview 会打开 DevTools（`ChatLabPreviewWebFrame`），与 `rightclick` action 无关

---

*文档版本与代码同步于 Chat Lab sidebar-action 鼠标扩展（mousedown / drag / hover 等）。*
