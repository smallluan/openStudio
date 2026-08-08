import { readLinkOpenModeLocal } from "./chatLabLinkOpenPreference.js";

/**
 * Image + chart display rules appended to agent system rows (Open Studio UI rendering).
 * @param {(key: string) => string} t
 * @param {{ linkOpenMode?: "sidebar" | "external"; webExploreMode?: boolean }} [opts]
 */
export function composeChatLabStudioSuffix(t, opts = {}) {
  const linkOpenMode = opts.linkOpenMode ?? readLinkOpenModeLocal();
  const parts = [
    // Tool Search first: models must discover Studio tools via search→describe→call.
    String(t("chatLab.toolSearchPrompt") ?? "").trim(),
    String(t("chatLab.windowsShellPrompt") ?? "").trim(),
    String(t("chatLab.bundledPythonPrompt") ?? "").trim(),
    "## Code search (required for project analysis)\nFor the selected project, use Tool Search for `git_grep`, `workspace_glob`, and `workspace_read` before using the generic shell tool. Use `git_status` or `git_log` for repository state and history. Pass the selected project root explicitly. Search first, then read only matching files; do not dump a codebase with repeated one-file shell reads.",
    String(t("chatLab.imageDisplayPrompt") ?? "").trim(),
    String(t("chatLab.chartDisplayPrompt") ?? "").trim(),
    String(t("chatLab.htmlDisplayPrompt") ?? "").trim(),
    String(t("chatLab.subagentSpawnPrompt") ?? "").trim(),
  ];
  if (opts.webExploreMode) {
    parts.push(String(t("webExploreChat.linkOpenPrompt") ?? "").trim());
    parts.push(String(t("webExploreChat.pageAutomationPrompt") ?? "").trim());
  } else if (linkOpenMode !== "external") {
    parts.push(String(t("chatLab.linkOpenSidebarPrompt") ?? "").trim());
    parts.push(String(t("chatLab.sidebarAutomationPrompt") ?? "").trim());
    parts.push(String(t("chatLab.sidebarPreviewCapabilitiesPrompt") ?? "").trim());
  }
  parts.push(String(t("chatLab.browserAutomationLimitPrompt") ?? "").trim());
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Short reminder on user turns: Tool Search must be used (survives system truncation).
 * @param {(key: string) => string} t
 */
export function composeToolSearchUserTurnHint(t) {
  return [
    String(t("chatLab.toolSearchUserTurnHint") ?? "").trim(),
    String(t("chatLab.windowsShellPrompt") ?? "").trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Short automation reminder prepended on each Web Explore user turn (survives system-prompt truncation).
 * @param {(key: string) => string} t
 */
export function composeWebExploreUserTurnAutomationHint(t) {
  return String(t("webExploreChat.userTurnAutomationHint") ?? "").trim();
}

/**
 * Scheduled Open Studio automation task execution (not a new user request).
 * @param {(key: string) => string} t
 */
export function composeAutomationExecutionSystemPrompt(t) {
  return String(t("chatLab.automationExecutionSystemPrompt") ?? "").trim();
}

/**
 * Base + image/chart display rules sent to the gateway as the Chat Lab system row.
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 * @param {{ linkOpenMode?: "sidebar" | "external"; workspaceContext?: string; previewContext?: string; automationExecution?: boolean }} [opts]
 */
export function composeChatLabSystemPrompt(t, opts = {}) {
  const parts = [
    String(t("chatLab.systemPrompt") ?? "").trim(),
    // Prefer volatile workspace/preview on the user turn; keep optional for legacy callers.
    String(opts.workspaceContext ?? "").trim(),
    String(opts.previewContext ?? "").trim(),
    opts.automationExecution ? composeAutomationExecutionSystemPrompt(t) : "",
    composeChatLabStudioSuffix(t, opts),
  ].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 * @param {{
 *   ok?: boolean;
 *   root?: string;
 *   label?: string;
 *   gitRoot?: string | null;
 *   gitBranch?: string | null;
 *   topLevel?: Array<{ name: string; kind: "file" | "dir" }>;
 *   readmeExcerpt?: string | null;
 *   packageName?: string | null;
 *   packageDescription?: string | null;
 * } | null | undefined} desc
 */
export function composeChatLabWorkspaceContextBlock(t, desc) {
  if (!desc?.ok || !desc.root) return "";
  const lines = [String(t("chatLab.workspaceContext.header") ?? "").trim()];
  lines.push(t("chatLab.workspaceContext.path", { path: desc.root }));
  if (desc.gitRoot) {
    lines.push(t("chatLab.workspaceContext.gitRoot", { path: desc.gitRoot }));
  }
  if (desc.gitBranch) {
    lines.push(t("chatLab.workspaceContext.branch", { branch: desc.gitBranch }));
  }
  if (desc.packageName || desc.packageDescription) {
    const pkgParts = [desc.packageName, desc.packageDescription].filter(Boolean);
    lines.push(t("chatLab.workspaceContext.package", { summary: pkgParts.join(" — ") }));
  }
  if (Array.isArray(desc.topLevel) && desc.topLevel.length) {
    lines.push(
      t("chatLab.workspaceContext.topLevel", {
        list: desc.topLevel.map((e) => e.name).join(", "),
      }),
    );
  }
  if (desc.readmeExcerpt) {
    lines.push(t("chatLab.workspaceContext.readme", { excerpt: desc.readmeExcerpt }));
  }
  lines.push(String(t("chatLab.workspaceContext.instruction") ?? "").trim());
  return lines.filter(Boolean).join("\n");
}

/**
 * @param {typeof window.studioBridge | undefined} bridge
 * @param {string | null | undefined} activeRoot
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 */
export async function fetchChatLabWorkspaceContextBlock(bridge, activeRoot, t) {
  const root = String(activeRoot ?? "").trim();
  if (!root || !bridge?.describeWorkspaceProject) return "";
  try {
    const desc = await bridge.describeWorkspaceProject({ root });
    return composeChatLabWorkspaceContextBlock(t, desc);
  } catch {
    return "";
  }
}
