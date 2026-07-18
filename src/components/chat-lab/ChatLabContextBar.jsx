import { ChevronDown, Folder, FolderOpen, GitBranch, Search, X } from "lucide-react";
import { Popup } from "tdesign-react";
import { Button, Input } from "@open-studio/udesign";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SearchSparkleIcon from "../../assets/svg/SearchSparkleIcon.jsx";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { useOptionalChatLabWorkspace } from "../../context/ChatLabWorkspaceContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import {
  OS_POPUP_ANCHOR_CLASS,
  OS_POPUP_INNER_CLASS,
  OS_POPUP_OVERLAY_CLASS,
  osPopupPopperOptions,
} from "../../ui/osPopupShared.js";
import { useVirtualPopupAnchor } from "../../ui/useVirtualPopupAnchor.js";
import { cn } from "../../ui/cn.js";
import { useDebouncedValue } from "../../ui/useDebouncedValue.js";

/** @typedef {"workspace" | "branch"} PanelKind */

/**
 * @param {{
 *   open: boolean;
 *   kind: PanelKind;
 *   query: string;
 *   onQueryChange: (v: string) => void;
 *   onClose: () => void;
 *   anchorRef: import("react").RefObject<HTMLElement | null>;
 *   workspaceRoot: string;
 *   workspaceLabel: string;
 *   recents: string[];
 *   recentPaths: string[];
 *   fileEntries: Array<{ path: string; name: string; rel: string }>;
 *   branches: string[];
 *   currentBranch: string;
 *   gitRepo: boolean;
 *   loading: boolean;
 *   hasSelection: boolean;
 *   selectedRoot: string | null;
 *   onClearSelection: () => void;
 *   onPickWorkspace: (path: string) => void;
 *   onOpenFolder: () => void;
 *   onPickFile: (path: string) => void;
 *   onPickBranch: (branch: string) => void;
 * }} props
 */
function ContextPopover({
  open,
  kind,
  query,
  onQueryChange,
  onClose,
  anchorRef,
  workspaceRoot,
  workspaceLabel,
  recents,
  recentPaths,
  fileEntries,
  branches,
  currentBranch,
  gitRepo,
  loading,
  hasSelection,
  selectedRoot,
  onClearSelection,
  onPickWorkspace,
  onOpenFolder,
  onPickFile,
  onPickBranch,
}) {
  const { t } = useI18n();
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const popupRef = useRef(/** @type {import("tdesign-react").PopupInstanceFunctions | null} */ (null));
  const openedAtRef = useRef(0);

  const getRect = useCallback(() => anchorRef.current?.getBoundingClientRect() ?? null, [anchorRef]);
  const { anchorRef: virtualAnchorRef } = useVirtualPopupAnchor({ open, getRect, popupRef });

  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open, kind]);

  const showRecents = kind === "workspace" && !query.trim();
  const showFiles = kind === "workspace" && query.trim().length > 0;
  const showBranches = kind === "branch";

  const popupContent = (
    <div
      className={cn(
        "chat-lab__context-popover",
        "flex w-full flex-col overflow-hidden rounded-[14px] border",
        "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
        "shadow-[var(--os-shadow-soft)]",
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="chat-lab__context-popover-search">
        <div className="min-w-0 flex-1">
          <Input
            ref={inputRef}
            block
            borderless
            clearable
            size="small"
            type="search"
            prefixIcon={<SearchSparkleIcon className="chat-lab__context-popover-search-icon" aria-hidden />}
            placeholder={
              kind === "branch"
                ? t("chatLab.contextBar.branchSearchPlaceholder")
                : t("chatLab.contextBar.workspaceSearchPlaceholder")
            }
            value={query}
            onChange={(value) => onQueryChange(value)}
            aria-label={
              kind === "branch"
                ? t("chatLab.contextBar.branchSearchPlaceholder")
                : t("chatLab.contextBar.workspaceSearchPlaceholder")
            }
          />
        </div>
      </div>

      <div className="chat-lab__context-popover-body" role="listbox">
        {loading ? <p className="chat-lab__context-popover-empty">{t("chatLab.contextBar.loading")}</p> : null}

        {showRecents ? (
          <>
            <p className="chat-lab__context-popover-section">{t("chatLab.contextBar.recents")}</p>
            <ul className="chat-lab__context-popover-list">
              {recentPaths.map((p) => {
                const isSelected = p === selectedRoot;
                return (
                  <li
                    key={p}
                    className={cn(
                      "chat-lab__context-popover-row",
                      isSelected && "chat-lab__context-popover-row--selected",
                    )}
                  >
                    <button
                      type="button"
                      className="chat-lab__context-popover-item"
                      onClick={() => onPickWorkspace(p)}
                    >
                      <Folder className="chat-lab__context-popover-item-icon" aria-hidden />
                      <span className="chat-lab__context-popover-item-label">{p}</span>
                    </button>
                    {isSelected ? (
                      <div className="chat-lab__context-item-suffix">
                        <button
                          type="button"
                          className="chat-lab__context-clear-btn"
                          aria-label={t("chatLab.contextBar.clearSelection")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onClearSelection();
                          }}
                        >
                          <X aria-hidden />
                        </button>
                        <span className="chat-lab__context-popover-check" aria-hidden>
                          ✓
                        </span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {!recentPaths.length && !hasSelection ? (
                <li>
                  <p className="chat-lab__context-popover-empty">{t("chatLab.contextBar.noSelectionHint")}</p>
                </li>
              ) : null}
            </ul>
          </>
        ) : null}

        {showFiles ? (
          <>
            <p className="chat-lab__context-popover-section">{t("chatLab.contextBar.files")}</p>
            {fileEntries.length ? (
              <ul className="chat-lab__context-popover-list">
                {fileEntries.map((ent) => (
                  <li key={ent.path}>
                    <button
                      type="button"
                      className="chat-lab__context-popover-item"
                      onClick={() => onPickFile(ent.path)}
                    >
                      <Search className="chat-lab__context-popover-item-icon" aria-hidden />
                      <span className="chat-lab__context-popover-item-label">{ent.rel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="chat-lab__context-popover-empty">{t("chatLab.contextBar.noResults")}</p>
            )}
          </>
        ) : null}

        {showBranches ? (
          gitRepo ? (
            branches.length ? (
              <ul className="chat-lab__context-popover-list">
                {branches.map((b) => (
                  <li key={b}>
                    <button
                      type="button"
                      className={cn(
                        "chat-lab__context-popover-item",
                        b === currentBranch && "chat-lab__context-popover-item--active",
                      )}
                      onClick={() => onPickBranch(b)}
                    >
                      <GitBranch className="chat-lab__context-popover-item-icon" aria-hidden />
                      <span className="chat-lab__context-popover-item-label">{b}</span>
                      {b === currentBranch ? (
                        <span className="chat-lab__context-popover-check" aria-hidden>
                          ✓
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="chat-lab__context-popover-empty">{t("chatLab.contextBar.noResults")}</p>
            )
          ) : (
            <p className="chat-lab__context-popover-empty">{t("chatLab.contextBar.notGitRepo")}</p>
          )
        ) : null}
      </div>

      {kind === "workspace" ? (
        <div className="chat-lab__context-popover-footer">
          <button type="button" className="chat-lab__context-popover-footer-btn" onClick={onOpenFolder}>
            <FolderOpen className="chat-lab__context-popover-footer-icon" aria-hidden />
            <span className="chat-lab__context-popover-footer-label">{t("chatLab.contextBar.openFolder")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <Popup
      ref={popupRef}
      visible={open}
      attach="body"
      placement="top-start"
      trigger="click"
      zIndex={400}
      destroyOnClose={false}
      overlayClassName={OS_POPUP_OVERLAY_CLASS}
      overlayInnerClassName={OS_POPUP_INNER_CLASS}
      popperOptions={osPopupPopperOptions(8, 8)}
      content={popupContent}
      onVisibleChange={(visible, context) => {
        if (visible) return;
        if (
          context?.trigger === "document" &&
          Date.now() - openedAtRef.current < 180
        ) {
          return;
        }
        if (context?.trigger === "document") {
          const target = context.e?.target;
          if (target instanceof Node && anchorRef.current?.contains(target)) {
            return;
          }
        }
        onClose();
      }}
    >
      <span ref={virtualAnchorRef} className={OS_POPUP_ANCHOR_CLASS} aria-hidden />
    </Popup>
  );
}

/**
 * Workspace + Git branch context bar above the chat composer (Cursor-style).
 */
export default function ChatLabContextBar() {
  const workspace = useOptionalChatLabWorkspace();
  if (!workspace) return null;
  return <ChatLabContextBarInner workspace={workspace} />;
}

/** @param {{ workspace: NonNullable<ReturnType<typeof useOptionalChatLabWorkspace>> }} props */
function ChatLabContextBarInner({ workspace }) {
  const { t } = useI18n();
  const preview = useChatLabPreview();
  const {
    activeRoot,
    hasSelection,
    setActiveRoot,
    clearSelection,
    refreshContext,
    workspaceRoot,
    workspaceLabel,
    git,
    recents,
  } = workspace;
  const workspaceBtnRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const branchBtnRef = useRef(/** @type {HTMLButtonElement | null} */ (null));

  const [panel, setPanel] = useState(/** @type {PanelKind | null} */ (null));
  const [panelKind, setPanelKind] = useState(/** @type {PanelKind} */ ("workspace"));
  const [query, setQuery] = useState("");
  const [fileEntries, setFileEntries] = useState(/** @type {Array<{ path: string; name: string; rel: string }>} */ ([]));
  const [loading, setLoading] = useState(false);
  const [branchBusy, setBranchBusy] = useState(false);

  const debouncedQuery = useDebouncedValue(query, 180);
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;

  const gitRepo = Boolean(git?.isRepo);
  const currentBranch = gitRepo ? String(git?.branch ?? "") : "";
  const allBranches = gitRepo && Array.isArray(git?.branches) ? git.branches : [];

  const filteredBranches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allBranches;
    return allBranches.filter((b) => b.toLowerCase().includes(q));
  }, [allBranches, query]);

  const recentPaths = useMemo(() => {
    const list = [...recents];
    if (hasSelection && activeRoot && !list.includes(activeRoot)) {
      list.unshift(activeRoot);
    }
    return list;
  }, [activeRoot, hasSelection, recents]);

  useEffect(() => {
    if (panel !== "workspace" || !debouncedQuery.trim() || !bridge?.searchWorkspaceFiles || !workspaceRoot) {
      setFileEntries([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    bridge
      .searchWorkspaceFiles({ root: workspaceRoot, query: debouncedQuery })
      .then((res) => {
        if (cancelled) return;
        setFileEntries(Array.isArray(res?.entries) ? res.entries : []);
      })
      .catch(() => {
        if (!cancelled) setFileEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, debouncedQuery, panel, workspaceRoot]);

  const applyWorkspaceRoot = useCallback(
    (path) => {
      setActiveRoot(path);
      setPanel(null);
      setQuery("");
    },
    [setActiveRoot],
  );

  const onOpenFolder = useCallback(async () => {
    if (!bridge?.pickWorkspaceFolder) return;
    try {
      const res = await bridge.pickWorkspaceFolder();
      if (res?.ok && res.path) applyWorkspaceRoot(res.path);
    } catch {
      /* ignore */
    }
  }, [applyWorkspaceRoot, bridge]);

  const onPickFile = useCallback(
    (filePath) => {
      setPanel(null);
      setQuery("");
      preview?.openFromWorkspacePath?.(filePath);
    },
    [preview],
  );

  const onPickBranch = useCallback(
    async (branch) => {
      if (!bridge?.checkoutGitBranch || branch === currentBranch || branchBusy || !workspaceRoot) return;
      setBranchBusy(true);
      try {
        const res = await bridge.checkoutGitBranch({ root: workspaceRoot, branch });
        if (!res?.ok) {
          window.alert(
            res?.message
              ? `${t("chatLab.contextBar.branchSwitchFailed")}\n${res.message}`
              : t("chatLab.contextBar.branchSwitchFailed"),
          );
        } else {
          await refreshContext();
          setPanel(null);
          setQuery("");
        }
      } catch {
        window.alert(t("chatLab.contextBar.branchSwitchFailed"));
      } finally {
        setBranchBusy(false);
      }
    },
    [branchBusy, bridge, currentBranch, refreshContext, t, workspaceRoot],
  );

  const onClearSelection = useCallback(() => {
    clearSelection();
    preview?.close?.();
    setPanel(null);
    setQuery("");
  }, [clearSelection, preview]);

  const openPanel = useCallback(
    /** @param {PanelKind} kind */
    (kind) => {
      setQuery("");
      setPanelKind(kind);
      setPanel((prev) => (prev === kind ? null : kind));
    },
    [],
  );

  const displayLabel = hasSelection
    ? workspaceLabel
    : t("chatLab.contextBar.selectPathPlaceholder");

  return (
    <div className="chat-lab__context-bar" role="toolbar" aria-label={t("chatLab.contextBar.toolbarAria")}>
      <Button
                variant="outline"
                size="small"
        ref={workspaceBtnRef}
        type="button"
        className={cn(
          "chat-lab__context-trigger",
          panel === "workspace" && "chat-lab__context-trigger--open",
        )}
        onClick={() => openPanel("workspace")}
        aria-expanded={panel === "workspace"}
        aria-haspopup="dialog"
      >
        <span className="chat-lab__context-trigger-label">{displayLabel}</span>
        <ChevronDown className="chat-lab__context-trigger-chevron" aria-hidden />
      </Button>

      {gitRepo && hasSelection ? (
        <Button
                variant="outline"
                size="small"
          ref={branchBtnRef}
          type="button"
          className={cn("chat-lab__context-trigger", panel === "branch" && "chat-lab__context-trigger--open")}
          onClick={() => openPanel("branch")}
          aria-expanded={panel === "branch"}
          aria-haspopup="dialog"
          disabled={branchBusy}
        >
          <GitBranch className="chat-lab__context-trigger-branch-icon" aria-hidden />
          <span className="chat-lab__context-trigger-label">{currentBranch || "—"}</span>
          <ChevronDown className="chat-lab__context-trigger-chevron" aria-hidden />
        </Button>
      ) : null}

      <ContextPopover
        open={panel !== null}
        kind={panel ?? panelKind}
        query={query}
        onQueryChange={setQuery}
        onClose={() => {
          setPanel(null);
          setQuery("");
        }}
        anchorRef={panel === "branch" || (panel === null && panelKind === "branch") ? branchBtnRef : workspaceBtnRef}
        workspaceRoot={workspaceRoot}
        workspaceLabel={displayLabel}
        recents={recents}
        recentPaths={recentPaths}
        fileEntries={fileEntries}
        branches={filteredBranches}
        currentBranch={currentBranch}
        gitRepo={gitRepo}
        loading={loading}
        hasSelection={hasSelection}
        selectedRoot={activeRoot}
        onClearSelection={onClearSelection}
        onPickWorkspace={applyWorkspaceRoot}
        onOpenFolder={onOpenFolder}
        onPickFile={onPickFile}
        onPickBranch={onPickBranch}
      />
    </div>
  );
}
