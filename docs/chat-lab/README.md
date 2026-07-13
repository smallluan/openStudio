# Chat Lab 文档

本目录存放 **Chat Lab**（聊天实验室）相关的设计与协议说明。

| 文档 | 说明 |
|------|------|
| [sidebar-action.md](./sidebar-action.md) | 右侧边栏网页自动化协议（`sidebar-action`） |

## 相关源码

- `src/chat/chatLabPreviewAutomation.js` — 步骤解析与 webview 内执行
- `src/chat/chatLabSidebarActionProtocol.js` — 从助手消息中提取步骤
- `src/components/chat-lab/ChatLabSidebarActionRunner.jsx` — 自动触发执行
- `src/chat/chatLabPreviewSnapshot.js` — 页面文字快照（只读）
