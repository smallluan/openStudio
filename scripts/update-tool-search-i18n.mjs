/**
 * One-shot: inject Tool Search i18n strings into locale JSON files.
 * Run: node scripts/update-tool-search-i18n.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const localesDir = path.join(root, "src", "i18n", "locales");

function load(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}

function save(p, j) {
  const raw = fs.readFileSync(p);
  const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const body = `${JSON.stringify(j, null, 2)}\n`;
  fs.writeFileSync(p, hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, "utf8")]) : body);
}

const EN = {
  toolSearchPrompt: `## Tool discovery (required — Tool Search is ON)
Open Studio exposes a large tool catalog. You do **not** receive tools like \`browser_open\`, \`browser_action\`, \`browser_debug\`, \`cron\`, or \`sessions_spawn\` as direct callable tools.
You only have: \`tool_search\`, \`tool_describe\`, \`tool_call\`.

Workflow (every Studio/browser/automation/debug tool):
1. \`tool_search\` with a short query (tool name or intent), e.g. \`browser_open\`, \`open url preview\`, \`click page\`, \`console logs\`, \`network requests\`, \`breakpoint\`, \`screenshot\`, \`sessions_spawn\`
2. \`tool_describe\` on the best hit \`id\` to load its schema
3. \`tool_call\` with that \`id\` and JSON \`args\`

Hard rules:
- Never invent a bare tool call named \`browser_open\` / \`browser_action\` / etc. — it will fail as unavailable
- If a tool fails as unavailable, search again; do not retry the bare name
- Studio preview tools: browser_open, browser_action, browser_debug, browser_screenshot, browser_debugger, browser_eval`,
  toolSearchUserTurnHint:
    "**Tool Search**: discover tools with `tool_search` → `tool_describe` → `tool_call`. Do not call `browser_open` / `browser_action` / other Studio tools by bare name.",
  linkOpenSidebarPrompt: `## Open web pages (right sidebar preview)
The user chose **Open links in the Open Studio right sidebar**, not the system browser.
- **To open a page**: Tool Search for \`browser_open\` / \`open url preview\`, then \`tool_describe\` → \`tool_call\` with \`{ "url": "https://..." }\`. Markdown links in your reply are **not** auto-opened.
- **To read**: use the injected sidebar snapshot + **interactive element inventory**
- **To control**: Tool Search for \`browser_action\` (see sidebar automation), then describe/call; each call appears in the tool trace mid-turn
- If the snapshot is a login gate, ask the user to sign in in the sidebar first
- Do not launch an external browser unless the user asks`,
  sidebarAutomationPrompt: `## Right sidebar automation (via Tool Search → \`browser_action\`)
When you need to type, click, search, scroll, or navigate in the sidebar page:
1. \`tool_search\` query \`browser_action\` (or \`click type scroll\`)
2. \`tool_describe\` the hit, then \`tool_call\` with \`{ "steps": [ ... ] }\` (max 5 steps)
Text alone does not execute. Do **not** emit \`\`\`sidebar-action\`\`\` fences. Do **not** call \`browser_action\` as a bare tool name.

### How it works
1. Read the **interactive element inventory** in the snapshot (each item has ref / selector / name)
2. tool_call a **short batch** (max 5 steps), e.g. one click, or focus→type→press
3. The tool result includes a fresh \`observation\` with \`elements[].ref\` — then call again or finish
4. When the task is done, answer the user in natural language
5. Do **not** dump a long multi-step script in one call

### Targeting rules
- Prefer: \`{"action":"click","ref":"e3"}\` (ref from inventory/observation)
- Or use inventory selector / label / placeholder / title
- **Never** invent natural-language \`target\` fields`,
  sidebarPreviewCapabilitiesPrompt: `## Chat Lab sidebar preview scope (not Web Explore)
You are in **Chat Lab right-sidebar preview**, not the **Web Explore** main viewport.
- **Available via Tool Search**: \`browser_action\` (click/type/scroll; works in both sidebar and Web Explore) + injected page snapshot and element inventory; \`browser_open\` to open URLs
- **Not in this session catalog (sidebar only)**: \`browser_debug\`, \`browser_debugger\`, \`browser_screenshot\`, \`browser_eval\` — registered **only in Web Explore**; do not claim you can use them
- If the user needs breakpoints, network capture, or deep front-end debugging: tell them to switch to **Web Explore**`,
  subagentSpawnPrompt: `## Subagents (parallel hard-block, via Tool Search)
Prefer subagents for parallelizable multi-workstream tasks, clear IO boundaries, or isolating context.

Calling rules (Tool Search ON):
- \`tool_search\` \`sessions_spawn\` → \`tool_describe\` → \`tool_call\`
- For multiple children, pass a \`tasks\` array in one spawn call when the schema supports it
- After parallel spawns, Tool Search/call \`sessions_yield\` as the barrier — do not poll with filler text
- Do **not** invent a bare \`sessions_spawn\` tool call outside tool_call`,
  userTurnAutomationHint:
    "**Web Explore page control (Tool Search)**: search/describe/call `browser_action` (and `browser_debug`, `browser_screenshot`, `browser_debugger`, `browser_eval`). **Do not** use `browser_open` (not in this session). To change URL, `browser_action` with a navigate step. Never call those names as bare tools. They target the current main viewport — never refuse because it is not Chat Lab sidebar preview.",
};

const ZH_CN = {
  toolSearchPrompt: `## 工具发现（必须 — 已启用 Tool Search）
Open Studio 工具很多。你**不会**直接拿到 \`browser_open\`、\`browser_action\`、\`browser_debug\`、\`cron\`、\`sessions_spawn\` 等可直接调用的工具。
你只有：\`tool_search\`、\`tool_describe\`、\`tool_call\`。

标准流程（所有 Studio / 浏览器 / 自动化 / 调试工具）：
1. \`tool_search\` 用短查询（工具名或意图），例如 \`browser_open\`、\`open url preview\`、\`click page\`、\`console logs\`、\`network requests\`、\`breakpoint\`、\`screenshot\`、\`sessions_spawn\`
2. 对最佳命中的 \`id\` 调用 \`tool_describe\` 加载 schema
3. 用该 \`id\` + JSON \`args\` 调用 \`tool_call\`

硬性规则：
- 禁止直接发起名为 \`browser_open\` / \`browser_action\` 等的裸工具调用 — 会报 unavailable
- 若报 unavailable，重新 search，不要反复裸调同名工具
- Studio 预览相关：browser_open、browser_action、browser_debug、browser_screenshot、browser_debugger、browser_eval`,
  toolSearchUserTurnHint:
    "**Tool Search**：用 `tool_search` → `tool_describe` → `tool_call` 发现并调用工具。不要直接裸调 `browser_open` / `browser_action` 等 Studio 工具名。",
  linkOpenSidebarPrompt: `## 打开网页（右侧栏预览）
用户选择了在 Open Studio **右侧栏**打开链接，而不是系统浏览器。
- **打开页面**：先 Tool Search \`browser_open\` / \`open url preview\`，再 \`tool_describe\` → \`tool_call\`，参数 \`{ "url": "https://..." }\`。回复里的 Markdown 链接**不会**自动打开。
- **阅读页面**：使用注入的侧栏快照 + **可交互元素清单**
- **操作页面**：Tool Search \`browser_action\`，再 describe/call；每次调用会出现在工具轨迹中
- 若快照是登录页，先请用户在侧栏登录
- 除非用户要求，否则不要打开外部浏览器`,
  sidebarAutomationPrompt: `## 右侧栏自动化（经 Tool Search → \`browser_action\`）
需要在侧栏页面输入、点击、搜索、滚动或导航时：
1. \`tool_search\` 查询 \`browser_action\`（或 \`click type scroll\`）
2. \`tool_describe\` 后 \`tool_call\`，参数 \`{ "steps": [ ... ] }\`（最多 5 步）
纯文字不会执行。不要输出 \`\`\`sidebar-action\`\`\` 代码块。不要裸调 \`browser_action\`。

### 工作方式
1. 阅读快照中的**可交互元素清单**（含 ref / selector / name）
2. tool_call 短批次（最多 5 步），例如单击，或 focus→type→press
3. 结果含新的 \`observation.elements[].ref\` — 再继续或结束
4. 完成后用自然语言回复用户
5. 不要一次塞很长脚本

### 定位规则
- 优先：\`{"action":"click","ref":"e3"}\`
- 或用 selector / label / placeholder / title
- **禁止**编造自然语言 \`target\` 字段`,
  sidebarPreviewCapabilitiesPrompt: `## Chat Lab 侧栏预览范围（非 Web Explore）
当前是 **Chat Lab 右侧栏预览**，不是 **Web Explore** 主视口。
- **可通过 Tool Search 使用**：\`browser_action\`（点击/输入/滚动；侧栏与 Web Explore 皆可）、\`browser_open\` 打开 URL，以及注入的页面快照与元素清单
- **本会话目录中没有（仅 Web Explore）**：\`browser_debug\`、\`browser_debugger\`、\`browser_screenshot\`、\`browser_eval\` — 不要声称可用
- 若用户需要断点、网络抓包或深度前端调试：请引导切换到 **Web Explore**`,
  subagentSpawnPrompt: `## 子智能体（并行硬阻塞，经 Tool Search）
适合可并行的多工作流、清晰 IO 边界、或需要隔离上下文的任务。

调用规则（已启用 Tool Search）：
- \`tool_search\` \`sessions_spawn\` → \`tool_describe\` → \`tool_call\`
- 多子任务时，若 schema 支持请在一次 spawn 中传 \`tasks\` 数组
- 并行 spawn 后须 Tool Search/call \`sessions_yield\` 作为屏障 — 不要用“还在等待”灌水
- 禁止在 tool_call 之外裸调 \`sessions_spawn\``,
  userTurnAutomationHint:
    "**Web Explore 页面操控（Tool Search）**：用 search/describe/call 调用 `browser_action`（以及 `browser_debug`、`browser_screenshot`、`browser_debugger`、`browser_eval`）。**禁止** `browser_open`（本会话未注册）。换 URL 用 `browser_action` 的 navigate。禁止裸调工具名。它们作用于当前主视口 — 不要因为不是 Chat Lab 侧栏就拒绝。",
};

const ZH_TW = {
  toolSearchPrompt: `## 工具發現（必須 — 已啟用 Tool Search）
Open Studio 工具很多。你**不會**直接拿到 \`browser_open\`、\`browser_action\`、\`browser_debug\`、\`cron\`、\`sessions_spawn\` 等可直接呼叫的工具。
你只有：\`tool_search\`、\`tool_describe\`、\`tool_call\`。

標準流程（所有 Studio / 瀏覽器 / 自動化 / 除錯工具）：
1. \`tool_search\` 用短查詢（工具名或意圖），例如 \`browser_open\`、\`open url preview\`、\`click page\`、\`console logs\`、\`network requests\`、\`breakpoint\`、\`screenshot\`、\`sessions_spawn\`
2. 對最佳命中的 \`id\` 呼叫 \`tool_describe\` 載入 schema
3. 用該 \`id\` + JSON \`args\` 呼叫 \`tool_call\`

硬性規則：
- 禁止直接發起名為 \`browser_open\` / \`browser_action\` 等的裸工具呼叫 — 會報 unavailable
- 若報 unavailable，重新 search，不要反覆裸調同名工具
- Studio 預覽相關：browser_open、browser_action、browser_debug、browser_screenshot、browser_debugger、browser_eval`,
  toolSearchUserTurnHint:
    "**Tool Search**：用 `tool_search` → `tool_describe` → `tool_call` 發現並呼叫工具。不要直接裸調 `browser_open` / `browser_action` 等 Studio 工具名。",
  linkOpenSidebarPrompt: `## 開啟網頁（右側欄預覽）
使用者選擇了在 Open Studio **右側欄**開啟連結，而不是系統瀏覽器。
- **開啟頁面**：先 Tool Search \`browser_open\` / \`open url preview\`，再 \`tool_describe\` → \`tool_call\`，參數 \`{ "url": "https://..." }\`。回覆裡的 Markdown 連結**不會**自動開啟。
- **閱讀頁面**：使用注入的側欄快照 + **可互動元素清單**
- **操作頁面**：Tool Search \`browser_action\`，再 describe/call；每次呼叫會出現在工具軌跡中
- 若快照是登入頁，先請使用者在側欄登入
- 除非使用者要求，否則不要開啟外部瀏覽器`,
  sidebarAutomationPrompt: `## 右側欄自動化（經 Tool Search → \`browser_action\`）
需要在側欄頁面輸入、點擊、搜尋、滾動或導航時：
1. \`tool_search\` 查詢 \`browser_action\`（或 \`click type scroll\`）
2. \`tool_describe\` 後 \`tool_call\`，參數 \`{ "steps": [ ... ] }\`（最多 5 步）
純文字不會執行。不要輸出 \`\`\`sidebar-action\`\`\` 程式碼區塊。不要裸調 \`browser_action\`。

### 工作方式
1. 閱讀快照中的**可互動元素清單**（含 ref / selector / name）
2. tool_call 短批次（最多 5 步），例如單擊，或 focus→type→press
3. 結果含新的 \`observation.elements[].ref\` — 再繼續或結束
4. 完成後用自然語言回覆使用者
5. 不要一次塞很長腳本

### 定位規則
- 優先：\`{"action":"click","ref":"e3"}\`
- 或用 selector / label / placeholder / title
- **禁止**編造自然語言 \`target\` 欄位`,
  sidebarPreviewCapabilitiesPrompt: `## Chat Lab 側欄預覽範圍（非 Web Explore）
目前是 **Chat Lab 右側欄預覽**，不是 **Web Explore** 主視口。
- **可透過 Tool Search 使用**：\`browser_action\`（點擊/輸入/滾動；側欄與 Web Explore 皆可）、\`browser_open\` 開啟 URL，以及注入的頁面快照與元素清單
- **本工作階段目錄中沒有（僅 Web Explore）**：\`browser_debug\`、\`browser_debugger\`、\`browser_screenshot\`、\`browser_eval\` — 不要聲稱可用
- 若使用者需要中斷點、網路抓包或深度前端除錯：請引導切換到 **Web Explore**`,
  subagentSpawnPrompt: `## 子智慧體（平行硬阻塞，經 Tool Search）
適合可平行的多工作流、清晰 IO 邊界、或需要隔離上下文的任務。

呼叫規則（已啟用 Tool Search）：
- \`tool_search\` \`sessions_spawn\` → \`tool_describe\` → \`tool_call\`
- 多子任務時，若 schema 支援請在一次 spawn 中傳 \`tasks\` 陣列
- 平行 spawn 後須 Tool Search/call \`sessions_yield\` 作為屏障 — 不要用「還在等待」灌水
- 禁止在 tool_call 之外裸調 \`sessions_spawn\``,
  userTurnAutomationHint:
    "**Web Explore 頁面操控（Tool Search）**：用 search/describe/call 呼叫 `browser_action`（以及 `browser_debug`、`browser_screenshot`、`browser_debugger`、`browser_eval`）。**禁止** `browser_open`（本工作階段未註冊）。換 URL 用 `browser_action` 的 navigate。禁止裸調工具名。它們作用於目前主視口 — 不要因為不是 Chat Lab 側欄就拒絕。",
};

const JA = {
  toolSearchPrompt: `## ツール発見（必須 — Tool Search 有効）
Open Studio は大きなツールカタログを持ちます。\`browser_open\` / \`browser_action\` / \`browser_debug\` / \`cron\` / \`sessions_spawn\` などは**直接呼び出し可能なツールとしては渡されません**。
使えるのは \`tool_search\` / \`tool_describe\` / \`tool_call\` のみです。

手順（Studio / ブラウザ / 自動化 / デバッグすべて）:
1. \`tool_search\` で短いクエリ（ツール名や意図）。例: \`browser_open\`, \`open url preview\`, \`click page\`, \`console logs\`, \`network requests\`, \`breakpoint\`, \`screenshot\`, \`sessions_spawn\`
2. 最良ヒットの \`id\` を \`tool_describe\`
3. その \`id\` と JSON \`args\` で \`tool_call\`

厳守:
- \`browser_open\` などを素のツール名で呼ばない（unavailable になる）
- unavailable なら再 search。同名の裸呼び出しを繰り返さない
- Studio プレビュー系: browser_open, browser_action, browser_debug, browser_screenshot, browser_debugger, browser_eval`,
  toolSearchUserTurnHint:
    "**Tool Search**: `tool_search` → `tool_describe` → `tool_call` で発見して呼ぶ。`browser_open` / `browser_action` などを素の名前で呼ばない。",
  linkOpenSidebarPrompt: `## Web ページを開く（右サイドバープレビュー）
ユーザーはシステムブラウザではなく Open Studio **右サイドバー**でリンクを開く設定です。
- **ページを開く**: Tool Search で \`browser_open\` / \`open url preview\` → \`tool_describe\` → \`tool_call\`（\`{ "url": "https://..." }\`）。返信の Markdown リンクは自動オープンされません。
- **読む**: 注入されたサイドバースナップショット + **操作可能要素インベントリ**
- **操作**: Tool Search で \`browser_action\` → describe/call
- ログイン壁なら、先にサイドバーでログインするよう案内
- ユーザーが求めない限り外部ブラウザを起動しない`,
  sidebarAutomationPrompt: `## 右サイドバー自動化（Tool Search → \`browser_action\`）
入力・クリック・検索・スクロール・ナビが必要なとき:
1. \`tool_search\` で \`browser_action\`（または \`click type scroll\`）
2. \`tool_describe\` の後 \`tool_call\` で \`{ "steps": [ ... ] }\`（最大 5）
テキストだけでは実行されません。\`\`\`sidebar-action\`\`\` フェンスや素の \`browser_action\` 呼び出しは禁止。

### 流れ
1. スナップショットの**要素インベントリ**（ref / selector / name）を読む
2. 短いバッチを tool_call（最大 5）
3. 新しい \`observation.elements[].ref\` を見て続行または終了
4. 完了したら自然言語で返答
5. 長いスクリプトを一度に載せない

### ターゲット
- 推奨: \`{"action":"click","ref":"e3"}\`
- または selector / label / placeholder / title
- 自然言語の \`target\` を捏造しない`,
  sidebarPreviewCapabilitiesPrompt: `## Chat Lab サイドバー範囲（Web Explore ではない）
今は **Chat Lab 右サイドバー**であり、**Web Explore** 主ビューではありません。
- **Tool Search で利用可**: \`browser_action\`（クリック/入力/スクロール）、\`browser_open\`、注入スナップショット
- **このセッションのカタログに無い（Web Explore のみ）**: \`browser_debug\`, \`browser_debugger\`, \`browser_screenshot\`, \`browser_eval\`
- ブレークポイントやネットワーク取得が必要なら **Web Explore** へ誘導`,
  subagentSpawnPrompt: `## サブエージェント（並列ハードブロック、Tool Search 経由）
並列化できる作業、明確な IO 境界、コンテキスト分離に使う。

ルール（Tool Search ON）:
- \`tool_search\` \`sessions_spawn\` → \`tool_describe\` → \`tool_call\`
- 複数子は schema が許せば \`tasks\` 配列で一度に
- 並列 spawn の後は \`sessions_yield\` をバリアに — 「まだ待っています」連打禁止
- tool_call 以外で \`sessions_spawn\` を裸呼びしない`,
  userTurnAutomationHint:
    "**Web Explore ページ操作（Tool Search）**: search/describe/call で `browser_action`（および `browser_debug` / `browser_screenshot` / `browser_debugger` / `browser_eval`）を使う。**`browser_open` は使わない**（未登録）。URL 変更は `browser_action` の navigate。素のツール名呼び出し禁止。対象は現在の主ビュー — Chat Lab サイドバーでないからと拒否しない。",
};

/** @type {Record<string, typeof EN>} */
const BY_LOCALE = {
  en: EN,
  "zh-CN": ZH_CN,
  "zh-TW": ZH_TW,
  ja: JA,
};

for (const [loc, patch] of Object.entries(BY_LOCALE)) {
  const p = path.join(localesDir, `${loc}.json`);
  const j = load(p);
  j.chatLab.toolSearchPrompt = patch.toolSearchPrompt;
  j.chatLab.toolSearchUserTurnHint = patch.toolSearchUserTurnHint;
  j.chatLab.linkOpenSidebarPrompt = patch.linkOpenSidebarPrompt;
  j.chatLab.sidebarAutomationPrompt = patch.sidebarAutomationPrompt;
  j.chatLab.sidebarPreviewCapabilitiesPrompt = patch.sidebarPreviewCapabilitiesPrompt;
  j.chatLab.subagentSpawnPrompt = patch.subagentSpawnPrompt;
  j.webExploreChat.userTurnAutomationHint = patch.userTurnAutomationHint;
  if (loc === "en" && typeof j.webExploreChat.pageAutomationPrompt === "string") {
    j.webExploreChat.pageAutomationPrompt = j.webExploreChat.pageAutomationPrompt
      .replace("**call the tool** `browser_action`", "Tool Search → describe → **tool_call** `browser_action`")
      .replaceAll("Call `browser_action`", "tool_call `browser_action` (after search/describe)")
      .replaceAll("call `browser_action` again", "tool_call `browser_action` again")
      .replace("call `browser_debug`", "Tool Search/call `browser_debug`");
  }
  save(p, j);
  console.log("[update-tool-search-i18n] updated", loc);
}
