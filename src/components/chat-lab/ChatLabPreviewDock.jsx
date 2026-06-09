import { useCallback, useEffect, useMemo, useState } from "react";
import ResizableEdge from "../../ui/ResizableEdge.jsx";
import { cn } from "../../ui/cn.js";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import ChatLabArtifactPreviewPane from "./ChatLabArtifactPreviewPane.jsx";

const PREVIEW_W_KEY = "openstudio_chat_preview_px";
const PREVIEW_W_DEFAULT = 520;
const PREVIEW_W_MIN = 360;
const PREVIEW_W_MAX = 880;
const TREE_W_KEY = "openstudio_chat_preview_tree_px";
const TREE_W_DEFAULT = 148;
const TREE_W_MIN = 112;
const TREE_W_MAX = 240;

function readStoredWidth(key, fallback, min, max) {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  } catch {
    /* ignore */
  }
  return fallback;
}

/** @param {string} code @param {(k: string, vars?: Record<string, string | number>) => string} t */
function mapArtifactError(code, t) {
  if (code === "workspace_needs_app") return t("chatLab.previewWorkspaceNeedsApp");
  if (code === "ipc_missing") return t("chatLab.previewIpcMissing");
  return code;
}

/**
 * @param {{
 *   extension?: {
 *     title: string;
 *     meta?: string;
 *     body: import("react").ReactNode;
 *   } | null;
 * }} props
 */
export default function ChatLabPreviewDock({ extension = null }) {
  const { t } = useI18n();
  const api = useChatLabPreview();
  const session = api?.session ?? null;
  const artifactsPanel = api?.artifactsPanel ?? null;
  const open = Boolean(session || artifactsPanel || extension);

  const [panelWidth, setPanelWidth] = useState(() =>
    readStoredWidth(PREVIEW_W_KEY, PREVIEW_W_DEFAULT, PREVIEW_W_MIN, PREVIEW_W_MAX),
  );
  const [treeWidth, setTreeWidth] = useState(() =>
    readStoredWidth(TREE_W_KEY, TREE_W_DEFAULT, TREE_W_MIN, TREE_W_MAX),
  );
  const [panelDragging, setPanelDragging] = useState(false);
  const [treeDragging, setTreeDragging] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_W_KEY, String(panelWidth));
    } catch {
      /* ignore */
    }
  }, [panelWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TREE_W_KEY, String(treeWidth));
    } catch {
      /* ignore */
    }
  }, [treeWidth]);

  const onOpenExternal = useCallback(() => {
    if (!session || session.kind !== "iframe") return;
    const url = session.externalUrl;
    if (!url) return;
    try {
      window.open(url, "_blank", "noreferrer,noopener");
    } catch {
      /* ignore */
    }
  }, [session]);

  const selectedArtifact = useMemo(() => {
    if (!artifactsPanel?.selectedPath) return null;
    return artifactsPanel.files.find((f) => f.path === artifactsPanel.selectedPath) ?? null;
  }, [artifactsPanel]);

  const previewTitle = useMemo(() => {
    if (extension?.title) return extension.title;
    if (artifactsPanel) return t("chatLab.artifactsDockTitle");
    return session?.title || t("chatLab.previewDefaultTitle");
  }, [artifactsPanel, extension?.title, session, t]);

  const artifactError = artifactsPanel?.error
    ? mapArtifactError(artifactsPanel.error, t)
    : null;

  if (!api || !open) return null;

  return (
    <aside
      className={cn(
        "chat-lab-preview-dock relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l",
        (panelDragging || treeDragging) && "chat-lab-preview-dock--resizing",
      )}
      style={{
        width: panelWidth,
        borderColor: "color-mix(in srgb, var(--os-border) 55%, transparent)",
        background: "var(--os-bg-elevated)",
      }}
      aria-label={t("chatLab.previewDockAria")}
    >
      <ResizableEdge
        side="left"
        value={panelWidth}
        min={PREVIEW_W_MIN}
        max={PREVIEW_W_MAX}
        onChange={setPanelWidth}
        onActiveChange={setPanelDragging}
      />
      <header className="chat-lab-preview-dock__head flex shrink-0 items-center gap-2 border-b px-2.5 py-2 pr-3">
        <h3 className="chat-lab-preview-dock__title min-w-0 flex-1 truncate text-[0.82rem] font-semibold leading-tight">
          {previewTitle}
        </h3>
        {extension?.meta ? (
          <span className="chat-lab-preview-dock__meta shrink-0 text-[0.76rem]">{extension.meta}</span>
        ) : null}
        {session?.kind === "iframe" && session.externalUrl ? (
          <button
            type="button"
            className="chat-lab-preview-dock__icon-btn"
            onClick={onOpenExternal}
            title={t("chatLab.previewOpenExternal")}
          >
            ↗
          </button>
        ) : null}
        {!extension ? (
          <button
            type="button"
            className="chat-lab-preview-dock__icon-btn"
            onClick={api.close}
            title={t("chatLab.previewClose")}
            aria-label={t("chatLab.previewClose")}
          >
            ×
          </button>
        ) : null}
      </header>

      {artifactsPanel ? (
        <div className="chat-lab-preview-dock__split flex min-h-0 flex-1">
          <nav
            className="chat-lab-preview-dock__tree relative flex min-h-0 shrink-0 flex-col border-r"
            style={{ width: treeWidth }}
            aria-label={t("chatLab.artifactsFileListAria")}
          >
            <ResizableEdge
              side="right"
              value={treeWidth}
              min={TREE_W_MIN}
              max={TREE_W_MAX}
              onChange={setTreeWidth}
              onActiveChange={setTreeDragging}
            />
            <ul className="chat-lab-preview-dock__tree-list min-h-0 flex-1 overflow-auto py-1">
              {artifactsPanel.files.map((file) => {
                const active = file.path === artifactsPanel.selectedPath;
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={cn(
                        "chat-lab-preview-dock__tree-item",
                        active && "chat-lab-preview-dock__tree-item--active",
                      )}
                      onClick={() => api.selectArtifact?.(file.path)}
                      title={file.path}
                    >
                      <span
                        className={cn(
                          "chat-lab-preview-dock__tree-badge",
                          file.op === "created"
                            ? "chat-lab-preview-dock__tree-badge--created"
                            : "chat-lab-preview-dock__tree-badge--modified",
                        )}
                      >
                        {file.op === "created" ? "+" : "~"}
                      </span>
                      <span className="chat-lab-preview-dock__tree-name">{file.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <ChatLabArtifactPreviewPane
            label={selectedArtifact?.label ?? artifactsPanel.selectedPath ?? ""}
            payload={artifactsPanel.payload}
            error={artifactError}
            loading={artifactsPanel.loading}
            viewMode={artifactsPanel.viewMode}
            onViewModeChange={(mode) => api.setArtifactViewMode?.(mode)}
            iframeRef={api.iframeRef}
          />
        </div>
      ) : extension ? (
        <div className="chat-lab-preview-dock__body chat-lab-preview-dock__body--orch min-h-0 flex-1 overflow-hidden">
          {extension.body}
        </div>
      ) : (
        <div className="chat-lab-preview-dock__body min-h-0 flex-1">
          {session?.kind === "placeholder" ? (
            <div className="chat-lab-preview-dock__placeholder muted px-3 py-3 text-[0.82rem] leading-relaxed">
              {session.body}
            </div>
          ) : (
            <iframe
              ref={api.iframeRef}
              className="chat-lab-preview-dock__frame h-full w-full border-0"
              title={session?.title || t("chatLab.previewDefaultTitle")}
              key={session?.frameKey}
              {...(session?.kind === "srcdoc"
                ? { srcDoc: session.html }
                : { src: session?.src ?? "" })}
              {...(session?.sandbox ? { sandbox: session.sandbox } : {})}
            />
          )}
        </div>
      )}
    </aside>
  );
}
