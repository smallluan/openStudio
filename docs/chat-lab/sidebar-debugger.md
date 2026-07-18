# 预览 JS 断点调试（`sidebar_debugger`）

与 `sidebar_action` / `sidebar_debug` **独立**的 OpenClaw 原生工具，用于在网页漫游 / Chat Lab 预览页上通过 CDP Debugger 设置断点、等待暂停并检查变量。

| 工具 | 用途 |
|------|------|
| `sidebar_debugger` | 搜索运行时代码 → 下断点 → 等待暂停 → 读变量 / 单步 |

共用 bridge：`OPEN_STUDIO_SIDEBAR_TOOL_URL`（默认 `http://127.0.0.1:19111`）。

---

## 推荐工作流

```
sidebar_debugger { op: "enable" }

# 全局搜关键词，每个命中行都下断点（等同 DevTools Ctrl+Shift+F）
sidebar_debugger { op: "break_on_text", text: "请联系管理员为此交易类型分配至少一个费用项目" }

# 可先 search 看命中列表；chunk 尚未加载时会 watch，加载后自动补断点
sidebar_debugger { op: "search", text: "isEmptyExpenseitems" }

# 或从 console 堆栈精确下断点（line 为 0-based）
sidebar_debugger { op: "break_on_location", url: "https://...", line: 42 }

sidebar_action { steps: [...] }   # 复现
# → 命中时立刻返回 debuggerPaused:true + inspect（不必等 120s 超时）
# → 预览出现蒙层 + 主题色胶囊条「已在断点处暂停」+ 播放键（用户也可手动放行）

# 也可显式等待（若 pause 已发生会立刻返回）
sidebar_debugger { op: "wait_paused", timeoutMs: 10000 }

sidebar_debugger { op: "inspect" }   # 若 action 已带 inspect 可跳过
sidebar_debugger { op: "evaluate", expression: "someVar" }

# 调试结束后必须放行；想再试一次也要先 resume，否则页面一直卡住
sidebar_debugger { op: "resume" }
# 或 step_over / step_into / step_out

sidebar_debugger { op: "disable" }
```

**重要**：`break_on_text` 默认会跳过语言包 / i18n 命中（字符串表加载后不会再执行）。优先对业务 chunk（如 `extend.*.js`）或错误 uuid / 函数名下断点。

可与 `sidebar_debug` 并行使用（同一 CDP attach，Network + Debugger 共存）。

---

## `op` 一览

| op | 说明 |
|----|------|
| `enable` | 开启 Debugger 会话，索引已加载脚本 |
| `disable` | 关闭会话并清除断点 |
| `status` | 脚本数、断点数、是否 paused |
| `list_scripts` | 列出已加载脚本（可 `urlContains` 过滤 chunk 文件名） |
| `search` | 在已加载 JS 中用 CDP `searchInContent` 搜索子串（支持 `urlContains`/`filename`） |
| `break_on_text` | 搜索 + 自动下断点（优先 .js，支持 `urlContains`） |
| `break_on_location` | 按 url/文件名 + line 下断点（支持 `scriptId`） |
| `clear_breakpoints` | 清除所有断点 |
| `wait_paused` | 等待命中断点或超时 |
| `inspect` | 暂停时返回堆栈、源码片段、作用域变量 |
| `evaluate` | 在暂停帧内求值 |
| `resume` / `step_over` / `step_into` / `step_out` | 继续执行 |

---

## 限制

- **暂无 source map**：搜到的是运行时 / 打包后的 JS
- **勿同时打开 guest DevTools**（会与 agent 的 CDP attach 冲突）
- **line 为 0-based**（与 CDP 一致；console 堆栈若是 1-based 需减 1）
- **全局搜索**：`break_on_text` / `search` 用 CDP `Debugger.searchInContent` 扫全部已加载脚本（与 DevTools Search 同源能力；不必知道 chunk 文件名；不再受本地 500KB 截断影响）
- **每个命中都下断点**：默认最多 12 处，等同你手动挨个打断点
- **动态 chunk**：未加载时会 `watch`，`scriptParsed` 后自动搜并补断点
- **search / break_on_***：会自动 `enable` 并等待脚本索引稳定后再搜

---

## 实现

| 组件 | 路径 |
|------|------|
| CDP 共享 | `lib/preview-guest-cdp.cjs` |
| Debugger | `lib/preview-guest-debugger.cjs` |
| HTTP | `POST /v1/sidebar_debugger` |
| OpenClaw 注入 | `scripts/patch-openclaw-sidebar-debugger.mjs` + `patches/openclaw@2026.6.1.patch` |
