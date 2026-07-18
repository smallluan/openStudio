# 预览调试 / 截图工具（`sidebar_debug` · `sidebar_screenshot`）

与 `sidebar_action` **独立**的两个 OpenClaw 原生工具，用于网页漫游 / Chat Lab 右侧预览的观测增强。

| 工具 | 用途 |
|------|------|
| `sidebar_debug` | 按需录制 console + 网络请求；目录摘要 → 再拉取详情 |
| `sidebar_screenshot` | 捕获当前视口截图（PNG 落盘，可选 base64） |

共用 bridge：`OPEN_STUDIO_SIDEBAR_TOOL_URL`（默认 `http://127.0.0.1:19111`）。

---

## 1. `sidebar_debug`

### 推荐工作流

```
# 需要首屏/首次进入才能拿到的请求或日志：
sidebar_debug { op: "start", reload: true }   # 先开录制，再刷新 webview

# 或已在录制中时单独刷新：
sidebar_debug { op: "reload" }

# 交互复现（非首屏场景）：
sidebar_debug { op: "start" }
sidebar_action { steps: [...] }

sidebar_debug { op: "catalog" }
sidebar_debug { op: "fetch", networkIds: ["req_12"], logIds: ["log_5"] }
sidebar_debug { op: "stop" }
```

也可用 `sidebar_action` 的 `{ "action": "reload" }` 刷新页面（与录制无关的一般刷新）。

大数据**不会**随每轮 context 自动注入；由模型自主选择拉取。

### `op` 一览

| op | 说明 |
|----|------|
| `start` | 开始录制；`clear` 默认 `true`；`reload: true` 时开录后立刻刷新 webview（抓首屏） |
| `reload` | 刷新当前预览/漫游页（可在录制中调用）；可选 `waitMs`、`ignoreCache` |
| `stop` | 停止录制（保留缓冲） |
| `clear` | 清空缓冲 |
| `status` | 录制状态与条数 |
| `catalog` | 返回 `logCatalog` / `networkCatalog`（id + summary） |
| `fetch` | 按 id 或过滤条件拉取详情（可含 response body） |

### catalog / fetch 常用过滤

- `onlyErrors` — 优先失败请求与 warn/error 日志  
- `urlContains` / `contains` — URL 或日志子串  
- `logLevels` — `["error","warn"]`  
- `networkIds` / `logIds` — 精确拉取  
- `includeResponseBody` — fetch 时是否带 body（默认 true）  
- `maxChars` — 截断长度  

敏感头（Cookie / Authorization 等）默认 redact。

### 实现

| 组件 | 路径 |
|------|------|
| 采集 | `lib/preview-guest-capture.cjs`（console-message + CDP Network） |
| HTTP | `POST /v1/sidebar_debug` → main 直接处理 |
| OpenClaw 注入 | `scripts/patch-openclaw-sidebar-preview-tools.mjs` |

---

## 2. `sidebar_screenshot`

```json
{ "includeBase64": false }
```

返回：

```json
{
  "ok": true,
  "path": ".../open-studio-preview-shots/shot-….png",
  "mimeType": "image/png",
  "width": 1280,
  "height": 800,
  "url": "https://..."
}
```

- 视口截图（`webContents.capturePage`），非整页长截  
- 默认不返回 base64；需要时设 `includeBase64: true`（过大则省略）  
- 有视觉能力的模型可读图；无视觉时仍可作落盘产物，交互仍用 `sidebar_action` + DOM inventory  

HTTP：`POST /v1/sidebar_screenshot`

---

## 3. 与 `sidebar_action` 的关系

- **不要**把录制/截图塞进 `sidebar_action` steps  
- 需要 debug 时：先 `sidebar_debug.start`，再操作，再 catalog/fetch  
- DOM 读不到图标按钮等场景：可先 `sidebar_screenshot`，再结合 inventory / 点击探测  
