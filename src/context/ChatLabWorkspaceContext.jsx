import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  pushWorkspaceRecent,
  readConversationWorkspace,
  readWorkspaceRecents,
  workspaceLabelFromPath,
  writeConversationWorkspace,
} from "../chat/chatLabWorkspaceStore.js";
import { useI18n } from "./I18nContext.jsx";

/** @typedef {{ isRepo: boolean; branch?: string; branches?: string[]; gitRoot?: string }} WorkspaceGitInfo */

/** @type {import("react").Context<null | {
 *   activeRoot: string | null;
 *   hasSelection: boolean;
 *   setActiveRoot: (path: string | null) => void;
 *   clearSelection: () => void;
 *   resetSelection: () => void;
 *   refreshContext: () => Promise<void>;
 *   workspaceRoot: string;
 *   workspaceLabel: string;
 *   git: WorkspaceGitInfo;
 *   recents: string[];
 * }>} */
export const ChatLabWorkspaceContext = createContext(null);

export function useChatLabWorkspace() {
  const ctx = useContext(ChatLabWorkspaceContext);
  if (!ctx) {
    throw new Error("useChatLabWorkspace must be used within ChatLabWorkspaceProvider");
  }
  return ctx;
}

/**
 * @param {{
 *   conversationId: string;
 *   isEmptySession: boolean;
 *   children: import("react").ReactNode;
 * }} props
 */
export function ChatLabWorkspaceProvider({ conversationId, isEmptySession, children }) {
  const { t } = useI18n();
  const [activeRoot, setActiveRootState] = useState(/** @type {string | null} */ (null));
  const [recents, setRecents] = useState(() => readWorkspaceRecents());
  const [context, setContext] = useState(
    /** @type {{ root: string; label: string; git: WorkspaceGitInfo } | null} */ (null),
  );

  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const hasSelection = Boolean(activeRoot);
  const prevEmptyRef = useRef(isEmptySession);

  useLayoutEffect(() => {
    if (prevEmptyRef.current && !isEmptySession && activeRoot && conversationId) {
      writeConversationWorkspace(conversationId, activeRoot);
    }
    prevEmptyRef.current = isEmptySession;
  }, [activeRoot, conversationId, isEmptySession]);

  useEffect(() => {
    if (isEmptySession) {
      setActiveRootState(null);
      return;
    }
    setActiveRootState(readConversationWorkspace(conversationId));
  }, [conversationId, isEmptySession]);

  const persistRoot = useCallback(
    (root) => {
      if (!isEmptySession && conversationId) {
        writeConversationWorkspace(conversationId, root);
      }
    },
    [conversationId, isEmptySession],
  );

  const refreshContext = useCallback(async () => {
    if (!bridge?.getWorkspaceContext || !activeRoot) {
      setContext(null);
      return;
    }
    try {
      const res = await bridge.getWorkspaceContext({ root: activeRoot });
      if (!res?.ok) return;
      setContext({
        root: res.root,
        label: res.label || workspaceLabelFromPath(res.root),
        git: res.git?.isRepo != null ? res.git : { isRepo: false },
      });
    } catch {
      /* ignore */
    }
  }, [activeRoot, bridge]);

  useEffect(() => {
    if (!activeRoot) {
      setContext(null);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      if (!bridge?.getWorkspaceContext) return;
      try {
        const res = await bridge.getWorkspaceContext({ root: activeRoot });
        if (cancelled || !res?.ok) return;
        setContext({
          root: res.root,
          label: res.label || workspaceLabelFromPath(res.root),
          git: res.git?.isRepo != null ? res.git : { isRepo: false },
        });
      } catch {
        if (!cancelled) setContext(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeRoot, bridge]);

  const setActiveRoot = useCallback(
    (path) => {
      const v = String(path ?? "").trim() || null;
      setActiveRootState(v);
      persistRoot(v);
      if (v) {
        pushWorkspaceRecent(v);
        setRecents(readWorkspaceRecents());
      }
    },
    [persistRoot],
  );

  const clearSelection = useCallback(() => {
    setActiveRootState(null);
    persistRoot(null);
    setContext(null);
  }, [persistRoot]);

  const resetSelection = clearSelection;

  useEffect(() => {
    if (!isEmptySession && activeRoot) {
      persistRoot(activeRoot);
    }
  }, [activeRoot, isEmptySession, persistRoot]);

  const workspaceRoot = hasSelection ? (context?.root ?? activeRoot ?? "") : "";
  const workspaceLabel = hasSelection
    ? (context?.label ?? workspaceLabelFromPath(activeRoot ?? ""))
    : t("chatLab.contextBar.selectPathPlaceholder");
  const git = hasSelection ? (context?.git ?? { isRepo: false }) : { isRepo: false };

  const value = useMemo(
    () => ({
      activeRoot,
      hasSelection,
      setActiveRoot,
      clearSelection,
      resetSelection,
      refreshContext,
      workspaceRoot,
      workspaceLabel,
      git,
      recents,
    }),
    [
      activeRoot,
      clearSelection,
      git,
      hasSelection,
      recents,
      refreshContext,
      resetSelection,
      setActiveRoot,
      workspaceLabel,
      workspaceRoot,
    ],
  );

  return <ChatLabWorkspaceContext.Provider value={value}>{children}</ChatLabWorkspaceContext.Provider>;
}
