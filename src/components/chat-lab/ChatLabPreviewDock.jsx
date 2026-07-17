import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@open-studio/udesign";
import { Code, ExternalLink, Monitor, RefreshCw, Smartphone, X } from "lucide-react";
import ResizableEdge from "../../ui/ResizableEdge.jsx";
import { cn } from "../../ui/cn.js";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import ChatLabArtifactPreviewPane from "./ChatLabArtifactPreviewPane.jsx";
import ChatLabPreviewFileTree from "./ChatLabPreviewFileTree.jsx";
import ChatLabPreviewWebFrame from "./ChatLabPreviewWebFrame.jsx";

const ChatLabPreviewAutomationDebugInput = lazy(
  () => import("./ChatLabPreviewAutomationDebugInput.jsx"),
);

const PREVIEW_W_KEY = "openstudio_chat_preview_px";
const PREVIEW_W_DEFAULT = 520;
const PREVIEW_W_MIN = 360;
const PREVIEW_W_MAX = 880;
const TREE_W_KEY = "openstudio_chat_preview_tree_px";
const TREE_W_DEFAULT = 148;
const TREE_W_MIN = 112;
const TREE_W_MAX = 240;
/** Keep in sync with `.chat-lab-preview-dock` width transition in index.css */
const PREVIEW_DOCK_ANIM_MS = 260;

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

function previewDockAnimMs() {
  if (typeof document === "undefined") return PREVIEW_DOCK_ANIM_MS;
  return document.documentElement.dataset.osMotion === "reduced" ? 0 : PREVIEW_DOCK_ANIM_MS;
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
  const wantsOpen = Boolean(session || artifactsPanel || extension);

  const snapshotRef = useRef(
    /** @type {{ session: typeof session; artifactsPanel: typeof artifactsPanel; extension: typeof extension } | null} */ (
      null
    ),
  );
  if (wantsOpen) {
    snapshotRef.current = { session, artifactsPanel, extension };
  }

  const [present, setPresent] = useState(wantsOpen);
  const [expanded, setExpanded] = useState(wantsOpen);
  const [contentReady, setContentReady] = useState(() => wantsOpen && previewDockAnimMs() === 0);

  // Open synchronously so link clicks show the dock immediately (rAF open left expanded=false / present=false).
  useLayoutEffect(() => {
    if (wantsOpen) {
      setPresent(true);
      setExpanded(true);
      setContentReady(true);
      return undefined;
    }
    setExpanded(false);
    setContentReady(false);
    return undefined;
  }, [wantsOpen]);

  useEffect(() => {
    if (!expanded) return undefined;
    const ms = previewDockAnimMs();
    if (ms <= 0) {
      setContentReady(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setContentReady(true), ms);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  useEffect(() => {
    if (expanded || !present) return undefined;
    const ms = previewDockAnimMs();
    if (ms <= 0) {
      setPresent(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setPresent(false), ms);
    return () => window.clearTimeout(timer);
  }, [expanded, present]);

  const snap = snapshotRef.current;
  const viewSession = wantsOpen ? session : snap?.session ?? null;
  const viewArtifacts = wantsOpen ? artifactsPanel : snap?.artifactsPanel ?? null;
  const viewExtension = wantsOpen ? extension : snap?.extension ?? null;

  const asideRef = useRef(/** @type {HTMLElement | null} */ (null));
  const treeRef = useRef(/** @type {HTMLElement | null} */ (null));

  const [panelWidth, setPanelWidth] = useState(() =>
    readStoredWidth(PREVIEW_W_KEY, PREVIEW_W_DEFAULT, PREVIEW_W_MIN, PREVIEW_W_MAX),
  );
  const [treeWidth, setTreeWidth] = useState(() =>
    readStoredWidth(TREE_W_KEY, TREE_W_DEFAULT, TREE_W_MIN, TREE_W_MAX),
  );
  const panelWidthLive = useRef(panelWidth);
  const treeWidthLive = useRef(treeWidth);
  panelWidthLive.current = panelWidth;
  treeWidthLive.current = treeWidth;

  const [panelDragging, setPanelDragging] = useState(false);
  const [treeDragging, setTreeDragging] = useState(false);
  const [showAutomationInputConfig, setShowAutomationInputConfig] = useState(false);
  const isResizing = panelDragging || treeDragging;

  const bridge = typeof window !== 'undefined' ? window.studioBridge : undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await bridge?.getUserConfig?.();
        if (!cancelled && c && typeof c === 'object') {
          setShowAutomationInputConfig(Boolean(c.chatLabShowAutomationDebugInput));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const dockWidth = wantsOpen || expanded ? panelWidth : 0;

  const persistWidth = useCallback((key, value) => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      /* ignore */
    }
  }, []);

  const onPanelLiveResize = useCallback((w) => {
    panelWidthLive.current = w;
    if (asideRef.current) asideRef.current.style.width = `${w}px`;
  }, []);

  const onPanelResizeCommit = useCallback(
    (w) => {
      setPanelWidth(w);
      persistWidth(PREVIEW_W_KEY, w);
    },
    [persistWidth],
  );

  const onTreeLiveResize = useCallback((w) => {
    treeWidthLive.current = w;
    if (treeRef.current) treeRef.current.style.width = `${w}px`;
  }, []);

  const onTreeResizeCommit = useCallback(
    (w) => {
      setTreeWidth(w);
      persistWidth(TREE_W_KEY, w);
    },
    [persistWidth],
  );

  const onOpenExternal = useCallback(() => {
    if (!viewSession || viewSession.kind !== "iframe") return;
    const url = viewSession.externalUrl;
    if (!url) return;
    try {
      if (typeof window.__openStudioOpenExternal === "function") {
        window.__openStudioOpenExternal(url);
        return;
      }
      window.open(url, "_blank", "noreferrer,noopener");
    } catch {
      /* ignore */
    }
  }, [viewSession]);

  const onReloadPreview = useCallback(() => {
    if (!viewSession || viewSession.kind !== "iframe") return;
    const webview = api?.webviewRef?.current;
    const iframe = api?.iframeRef?.current;
    if (viewSession.useWebview && webview) {
      try {
        webview.reload?.();
        return;
      } catch {
        /* fallthrough to iframe path */
      }
    }
    if (iframe) {
      try {
        const currentSrc = viewSession.externalUrl ?? viewSession.src ?? "";
        if (currentSrc) {
          iframe.src = currentSrc;
          return;
        }
        iframe.contentWindow?.location.reload?.();
      } catch {
        /* ignore */
      }
    }
  }, [viewSession, api?.webviewRef, api?.iframeRef]);

  const onPreviewNavigate = useCallback(
    (url) => {
      api?.navigatePreviewTo?.(url);
    },
    [api],
  );

  const showDeviceToggle = useMemo(() => {
    if (viewSession?.kind !== "iframe") return false;
    const url = viewSession.externalUrl ?? viewSession.src;
    return Boolean(url && /^https?:\/\//i.test(url));
  }, [viewSession]);

  const previewTabItems = useMemo(
    () =>
      (api?.previewTabs ?? []).map((tab) => ({
        id: tab.id,
        label: String(tab.title ?? "").trim() || t("chatLab.previewTabUntitled"),
        src: String(tab.src ?? "").trim(),
      })),
    [api?.previewTabs, t],
  );

  const showPreviewTabs = Boolean(
    !viewArtifacts &&
      !viewExtension &&
      viewSession?.kind === "iframe" &&
      previewTabItems.length > 0,
  );

  const selectedArtifact = useMemo(() => {
    if (!viewArtifacts?.selectedPath) return null;
    return viewArtifacts.files.find((f) => f.path === viewArtifacts.selectedPath) ?? null;
  }, [viewArtifacts]);

  const artifactOps = useMemo(() => {
    /** @type {Map<string, import("../../chat/chatLabSessionArtifacts.js").ArtifactOp>} */
    const map = new Map();
    for (const f of viewArtifacts?.files ?? []) {
      const key = String(f.path ?? "").replace(/\\/g, "/").toLowerCase();
      if (key) map.set(key, f.op);
    }
    return map;
  }, [viewArtifacts?.files]);

  const previewTitle = useMemo(() => {
    if (viewExtension?.title) return viewExtension.title;
    if (viewArtifacts) return t("chatLab.artifactsDockTitle");
    return viewSession?.title || t("chatLab.previewDefaultTitle");
  }, [viewArtifacts, viewExtension?.title, viewSession, t]);

  const artifactError = viewArtifacts?.error
    ? mapArtifactError(viewArtifacts.error, t)
    : null;

  const showArtifactTree = Boolean(
    viewArtifacts && viewArtifacts.treeMode !== "file-only",
  );

  const showAutomationDebugInput = Boolean(
    showAutomationInputConfig &&
    !viewArtifacts &&
      !viewExtension &&
      viewSession?.kind === "iframe" &&
      viewSession.useWebview,
  );

  const [urlInputValue, setUrlInputValue] = useState("");
  const urlInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  useEffect(() => {
    if (viewSession?.kind === "iframe") {
      const url = viewSession.externalUrl ?? viewSession.src ?? "";
      setUrlInputValue(url);
    } else {
      setUrlInputValue("");
    }
  }, [viewSession]);

  const handleUrlSubmit = useCallback(
    (e) => {
      e?.preventDefault?.();
      const url = urlInputValue.trim();
      if (!url || !/^https?:\/\//i.test(url)) return;
      api?.navigatePreviewTo?.(url);
    },
    [api, urlInputValue],
  );

  const runAutomationDebug = useCallback(
    async (steps) => {
      if (!api?.runSidebarAutomation) {
        return { ok: false, error: "automation_unavailable", steps: [] };
      }
      return api.runSidebarAutomation(steps, { stopOnFailure: true });
    },
    [api],
  );

  if (!api || (!wantsOpen && !present)) return null;

  return (
    <aside
      ref={asideRef}
      className={cn(
        "chat-lab-preview-dock relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l",
        !wantsOpen && !expanded && "chat-lab-preview-dock--collapsed",
        isResizing && "chat-lab-preview-dock--resizing",
      )}
      style={{
        width: dockWidth,
        borderColor: "color-mix(in srgb, var(--os-border) 55%, transparent)",
        background: "var(--os-bg-elevated)",
      }}
      aria-label={t("chatLab.previewDockAria")}
      aria-hidden={!wantsOpen && !expanded}
    >
      <ResizableEdge
        side="left"
        value={panelWidth}
        min={PREVIEW_W_MIN}
        max={PREVIEW_W_MAX}
        onChange={onPanelLiveResize}
        onCommit={onPanelResizeCommit}
        onActiveChange={setPanelDragging}
      />
      <header className="chat-lab-preview-dock__head flex shrink-0 items-center gap-2 border-b px-2.5 py-2 pr-3">
        {showAutomationDebugInput ? (
          <div className="chat-lab-preview-dock__head-main min-w-0 flex flex-1 flex-col gap-1">
            <form className="chat-lab-preview-dock__url-bar" onSubmit={handleUrlSubmit}>
              <Input
                ref={urlInputRef}
                block
                borderless
                clearable
                size="small"
                type="text"
                value={urlInputValue}
                onChange={(value) => setUrlInputValue(value)}
                onEnter={() => handleUrlSubmit()}
                placeholder="https://example.com"
                spellCheck={false}
                autocomplete="off"
                aria-label={t("chatLab.previewUrlBar")}
              />
            </form>
            <Suspense
              fallback={
                <div
                  className="chat-lab-preview-dock__automation-input chat-lab-preview-dock__automation-input--placeholder"
                  aria-hidden
                />
              }
            >
              <ChatLabPreviewAutomationDebugInput
                onRun={runAutomationDebug}
                disabled={!api?.runSidebarAutomation}
              />
            </Suspense>
          </div>
        ) : (
          <form className="chat-lab-preview-dock__url-bar flex-1" onSubmit={handleUrlSubmit}>
            <Input
              ref={urlInputRef}
              block
              borderless
              clearable
              size="small"
              type="text"
              value={urlInputValue}
              onChange={(value) => setUrlInputValue(value)}
              onEnter={() => handleUrlSubmit()}
              placeholder="https://example.com"
              spellCheck={false}
              autocomplete="off"
              aria-label={t("chatLab.previewUrlBar")}
            />
          </form>
        )}
        {viewExtension?.meta ? (
          <span className="chat-lab-preview-dock__meta shrink-0 text-[0.76rem]">{viewExtension.meta}</span>
        ) : null}
        {showDeviceToggle ? (
          <div
            className="chat-lab-preview-dock__device-toggle flex shrink-0 items-center gap-0.5"
            role="group"
            aria-label={t("chatLab.previewDeviceModeAria")}
          >
            <Button
              type="button"
              variant="text"
              shape="square"
              size="small"
              className={cn(
                "chat-lab-preview-dock__icon-btn chat-lab-preview-dock__device-btn",
                api?.deviceMode === "desktop" && "chat-lab-preview-dock__device-btn--active",
              )}
              onClick={() => api?.setDeviceMode?.("desktop")}
              title={t("chatLab.previewDeviceDesktop")}
              aria-label={t("chatLab.previewDeviceDesktop")}
              aria-pressed={api?.deviceMode === "desktop"}
            >
              <Monitor size={15} strokeWidth={1.75} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="text"
              shape="square"
              size="small"
              className={cn(
                "chat-lab-preview-dock__icon-btn chat-lab-preview-dock__device-btn",
                api?.deviceMode === "mobile" && "chat-lab-preview-dock__device-btn--active",
              )}
              onClick={() => api?.setDeviceMode?.("mobile")}
              title={t("chatLab.previewDeviceMobile")}
              aria-label={t("chatLab.previewDeviceMobile")}
              aria-pressed={api?.deviceMode === "mobile"}
            >
              <Smartphone size={15} strokeWidth={1.75} aria-hidden />
            </Button>
          </div>
        ) : null}
        {viewSession?.kind === "iframe" ? (
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className="chat-lab-preview-dock__icon-btn"
            onClick={onReloadPreview}
            title={t("chatLab.previewReload")}
            aria-label={t("chatLab.previewReload")}
          >
            <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
          </Button>
        ) : null}
        {viewSession?.kind === "iframe" && viewSession.useWebview ? (
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className="chat-lab-preview-dock__icon-btn"
            onClick={() => api?.openWebviewDevTools?.()}
            title={t("chatLab.previewOpenDevTools")}
            aria-label={t("chatLab.previewOpenDevTools")}
          >
            <Code size={15} strokeWidth={1.75} aria-hidden />
          </Button>
        ) : null}
        {viewSession?.kind === "iframe" && viewSession.externalUrl && api?.linkOpenMode === "sidebar" ? (
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className="chat-lab-preview-dock__icon-btn"
            onClick={onOpenExternal}
            title={t("chatLab.previewOpenExternal")}
            data-preview-bypass="true"
          >
            <ExternalLink size={15} strokeWidth={1.75} aria-hidden />
          </Button>
        ) : null}
        {(viewExtension || viewSession) ? (
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className="chat-lab-preview-dock__icon-btn"
            onClick={api.close}
            title={t("chatLab.previewClose")}
            aria-label={t("chatLab.previewClose")}
          >
            ×
          </Button>
        ) : null}
      </header>
      {showPreviewTabs ? (
        <div
          className="chat-lab-preview-dock__tabs flex shrink-0 items-end gap-0.5 overflow-x-auto border-b px-1.5 pt-1.5 pb-0"
          role="tablist"
          aria-label={t("chatLab.previewTabsAria")}
        >
          {previewTabItems.map((tab) => {
            const active = tab.id === api?.activePreviewTabId;
            return (
              <div
                key={tab.id}
                className={cn(
                  "chat-lab-preview-dock__tab-card flex items-center gap-1",
                  active && "chat-lab-preview-dock__tab-card--active",
                )}
              >
                <Button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={tab.label}
                  variant="text"
                  className="chat-lab-preview-dock__tab-label flex-1 min-w-0 truncate text-left"
                  onClick={() => api?.activatePreviewTab?.(tab.id)}
                  title={tab.src || tab.label}
                >
                  {tab.label}
                </Button>
                <Button
                  type="button"
                  role="tab"
                  variant="text"
                  shape="square"
                  size="small"
                  className="chat-lab-preview-dock__tab-close shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    api?.closePreviewTab?.(tab.id);
                  }}
                  title={t("chatLab.previewTabClose")}
                  aria-label={t("chatLab.previewTabClose")}
                >
                  <X size={12} strokeWidth={2} aria-hidden />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      {!contentReady ? (
        <div className="chat-lab-preview-dock__body min-h-0 flex-1" aria-hidden />
      ) : viewArtifacts ? (
        <div className="chat-lab-preview-dock__split flex min-h-0 min-w-0 flex-1">
          {showArtifactTree ? (
            <nav
              ref={treeRef}
              className="chat-lab-preview-dock__tree relative flex min-h-0 shrink-0 flex-col border-r"
              style={{ width: treeWidth }}
              aria-label={t("chatLab.artifactsFileListAria")}
            >
              <ResizableEdge
                side="right"
                value={treeWidth}
                min={TREE_W_MIN}
                max={TREE_W_MAX}
                onChange={onTreeLiveResize}
                onCommit={onTreeResizeCommit}
                onActiveChange={setTreeDragging}
              />
              {viewArtifacts.tree?.length ? (
                <ChatLabPreviewFileTree
                  nodes={viewArtifacts.tree}
                  selectedPath={viewArtifacts.selectedPath}
                  artifactOps={artifactOps}
                  onSelectFile={(path) => api.selectArtifact?.(path)}
                />
              ) : (
                <ul className="chat-lab-preview-dock__tree-list min-h-0 flex-1 overflow-auto py-1">
                  {viewArtifacts.files.map((file) => {
                    const active = file.path === viewArtifacts.selectedPath;
                    return (
                      <li key={file.path}>
                        <Button
                          type="button"
                          variant="text"
                          block
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
                                : file.op === "modified"
                                  ? "chat-lab-preview-dock__tree-badge--modified"
                                  : "chat-lab-preview-dock__tree-badge--viewed",
                            )}
                          >
                            {file.op === "created" ? "+" : file.op === "modified" ? "~" : "↗"}
                          </span>
                          <span className="chat-lab-preview-dock__tree-name">{file.label}</span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </nav>
          ) : null}
          <ChatLabArtifactPreviewPane
            label={selectedArtifact?.label ?? viewArtifacts.selectedPath ?? ""}
            payload={viewArtifacts.payload}
            error={artifactError}
            loading={viewArtifacts.loading}
            viewMode={viewArtifacts.viewMode}
            onViewModeChange={(mode) => api.setArtifactViewMode?.(mode)}
            iframeRef={api.iframeRef}
            isResizing={isResizing}
          />
        </div>
      ) : viewExtension && !viewSession ? (
        <div className="chat-lab-preview-dock__body chat-lab-preview-dock__body--orch min-h-0 flex-1 overflow-hidden">
          {viewExtension.body}
        </div>
      ) : (
        <div className="chat-lab-preview-dock__body min-h-0 flex-1">
          {viewSession?.kind === "placeholder" ? (
            <div className="chat-lab-preview-dock__placeholder muted px-3 py-3 text-[0.82rem] leading-relaxed">
              {viewSession.body}
            </div>
          ) : viewSession?.kind === "iframe" && viewSession.useWebview ? (
            <ChatLabPreviewWebFrame
              src={viewSession.src}
              title={viewSession.title || t("chatLab.previewDefaultTitle")}
              frameKey={viewSession.frameKey}
              sandbox={viewSession.sandbox}
              useWebview
              deviceMode={api?.deviceMode ?? "desktop"}
              iframeRef={api.iframeRef}
              webviewRefFromContext={api.webviewRef}
              onNavigate={onPreviewNavigate}
            />
          ) : (
            <iframe
              ref={api.iframeRef}
              className="chat-lab-preview-dock__frame h-full w-full border-0"
              title={viewSession?.title || t("chatLab.previewDefaultTitle")}
              key={viewSession?.frameKey}
              {...(viewSession?.kind === "srcdoc"
                ? { srcDoc: viewSession.html }
                : { src: viewSession?.src ?? "" })}
              {...(viewSession?.sandbox ? { sandbox: viewSession.sandbox } : {})}
            />
          )}
        </div>
      )}
    </aside>
  );
}
