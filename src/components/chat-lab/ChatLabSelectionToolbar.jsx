import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, FolderOpen, MessageCircleQuestion, Search } from "lucide-react";
import { openChatLabPreferredUrl } from "../../chat/chatLabLinkOpenPreference.js";
import {
  readChatTextSelection,
  resolveFollowUpFromSelection,
  selectionToolbarFlipFallbacks,
} from "../../chat/chatLabFollowUp.js";
import { classifySelectionAddress, openChatLabLocalPath } from "../../chat/chatLabSelectionAddress.js";
import { ChatLabPreviewContext } from "../../context/ChatLabPreviewContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import ChatLabContextMenu from "./ChatLabContextMenu.jsx";

/**
 * @typedef {{
 *   quoteText: string;
 *   sourceMessageId: string;
 *   sourceRole: "user" | "assistant";
 *   sourceAgentId?: string | null;
 * }} FollowUpSelectionPayload
 */

/**
 * @param {{
 *   scrollContainerRef?: import("react").RefObject<HTMLElement | null>;
 *   onFollowUp?: (payload: FollowUpSelectionPayload) => void;
 *   followUpDisabled?: boolean;
 * }} props
 */
export default function ChatLabSelectionToolbar({
  scrollContainerRef,
  onFollowUp,
  followUpDisabled = false,
}) {
  const { t } = useI18n();
  const previewApi = useContext(ChatLabPreviewContext);
  const [open, setOpen] = useState(false);
  const selectedTextRef = useRef("");
  const anchorRectRef = useRef(/** @type {DOMRect | null} */ (null));
  const followUpPayloadRef = useRef(/** @type {FollowUpSelectionPayload | null} */ (null));
  const [selectionAddress, setSelectionAddress] = useState(
    /** @type {ReturnType<typeof classifySelectionAddress>} */ (null),
  );
  const [placement, setPlacement] = useState(
    /** @type {import("@floating-ui/react").Placement} */ ("bottom-end"),
  );

  const resolveFollowUpPayload = useCallback(() => {
    const hit = readChatTextSelection();
    if (!hit) return null;

    const sel = window.getSelection();
    const anchorNode = sel?.anchorNode;
    if (!anchorNode) return null;

    /** @param {Node} node */
    const asElement = (node) =>
      node.nodeType === Node.TEXT_NODE ? node.parentElement : /** @type {Element} */ (node);

    const msgEl = asElement(anchorNode)?.closest("[data-message-id]");
    if (!msgEl) return null;

    const sourceMessageId = msgEl.getAttribute("data-message-id") ?? "";
    const sourceRole = msgEl.getAttribute("data-message-role");
    if (!sourceMessageId || (sourceRole !== "user" && sourceRole !== "assistant")) return null;

    const sourceAgentId = msgEl.getAttribute("data-message-agent-id");

    return {
      quoteText: hit.text,
      sourceMessageId,
      sourceRole,
      ...(sourceAgentId ? { sourceAgentId } : {}),
    };
  }, []);

  const syncFromSelection = useCallback(() => {
    const hit = readChatTextSelection();
    if (!hit) {
      setOpen(false);
      setSelectionAddress(null);
      anchorRectRef.current = null;
      followUpPayloadRef.current = null;
      return;
    }
    selectedTextRef.current = hit.text;
    anchorRectRef.current = hit.popupAnchorRect;
    followUpPayloadRef.current = resolveFollowUpPayload();
    setSelectionAddress(classifySelectionAddress(hit.text));
    setPlacement(hit.placement);
    setOpen(true);
  }, [resolveFollowUpPayload]);

  const getAnchorRect = useCallback(() => anchorRectRef.current, []);

  const flipFallbackPlacements = useMemo(
    () => selectionToolbarFlipFallbacks(placement),
    [placement],
  );

  const handleOpenChange = useCallback((next) => {
    setOpen(next);
    if (!next) {
      anchorRectRef.current = null;
      followUpPayloadRef.current = null;
    }
  }, []);

  useEffect(() => {
    /** @param {MouseEvent} e */
    const onMouseUp = (e) => {
      const target = /** @type {HTMLElement | null} */ (e.target instanceof HTMLElement ? e.target : null);
      if (target?.closest(".chat-lab__context-menu")) return;
      // Defer until after TDesign Popup's document-click dismiss handler on the same mouseup.
      window.setTimeout(syncFromSelection, 0);
    };

    /** @param {MouseEvent} e */
    const onMouseDown = (e) => {
      const target = /** @type {HTMLElement | null} */ (e.target instanceof HTMLElement ? e.target : null);
      if (target?.closest(".chat-lab__context-menu")) return;
      handleOpenChange(false);
    };

    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      if (e.key === "Escape") handleOpenChange(false);
    };

    /** @param {TouchEvent} e */
    const onTouchEnd = (e) => {
      const target = /** @type {HTMLElement | null} */ (
        e.target instanceof HTMLElement ? e.target : null
      );
      if (target?.closest(".chat-lab__context-menu")) return;
      window.setTimeout(syncFromSelection, 0);
    };

    const onSelectionChange = () => {
      if (!open) return;
      const hit = readChatTextSelection();
      if (!hit) return;
      anchorRectRef.current = hit.popupAnchorRect;
      setPlacement(hit.placement);
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("selectionchange", onSelectionChange);

    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [handleOpenChange, open, syncFromSelection]);

  const close = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
  }, []);

  const handleCopy = useCallback(async () => {
    const text = selectedTextRef.current;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        /* ignore */
      }
    }
    close();
    clearSelection();
  }, [close, clearSelection]);

  const handleFollowUp = useCallback(() => {
    if (followUpDisabled || !onFollowUp) return;
    const payload = followUpPayloadRef.current ?? resolveFollowUpFromSelection();
    if (!payload) return;
    onFollowUp(payload);
    close();
    clearSelection();
  }, [followUpDisabled, onFollowUp, close, clearSelection]);

  const handleSearch = useCallback(() => {
    const text = selectedTextRef.current;
    if (!text) return;
    openChatLabPreferredUrl(`https://www.google.com/search?q=${encodeURIComponent(text)}`);
    close();
    clearSelection();
  }, [close, clearSelection]);

  const handleOpenAddress = useCallback(() => {
    if (!selectionAddress) return;
    if (selectionAddress.kind === "url") {
      if (previewApi?.openFromHref?.(selectionAddress.href, selectionAddress.href)) {
        close();
        clearSelection();
        return;
      }
      openChatLabPreferredUrl(selectionAddress.href);
    } else {
      openChatLabLocalPath(selectionAddress.path, previewApi);
    }
    close();
    clearSelection();
  }, [close, clearSelection, previewApi, selectionAddress]);

  const items = useMemo(() => {
    const base = [
      {
        id: "copy",
        label: t("chatLab.selectionCopy"),
        icon: <Copy className="text-[var(--os-text-muted)]" size={15} strokeWidth={2} aria-hidden />,
        onClick: handleCopy,
      },
      {
        id: "follow-up",
        label: t("chatLab.selectionFollowUp"),
        icon: (
          <MessageCircleQuestion className="text-[var(--os-text-muted)]" size={15} strokeWidth={2} aria-hidden />
        ),
        onClick: handleFollowUp,
        disabled: followUpDisabled,
      },
      {
        id: "search",
        label: t("chatLab.selectionSearch"),
        icon: <Search className="text-[var(--os-text-muted)]" size={15} strokeWidth={2} aria-hidden />,
        onClick: handleSearch,
      },
    ];

    if (!selectionAddress) return base;

    const isAbsoluteLocal =
      selectionAddress.kind === "local" &&
      /^(?:[a-zA-Z]:[\\/]|\\\\|file:|\/|~)/i.test(selectionAddress.path);
    const canOpenLocal =
      selectionAddress.kind === "local" &&
      (isAbsoluteLocal
        ? Boolean(typeof window !== "undefined" && window.studioBridge?.revealLocalPath)
        : Boolean(previewApi?.openFromWorkspacePath));

    if (selectionAddress.kind === "url" || canOpenLocal) {
      base.push({
        id: "open-address",
        label:
          selectionAddress.kind === "url"
            ? t("chatLab.selectionOpenUrl")
            : t("chatLab.selectionOpenFileLocation"),
        icon:
          selectionAddress.kind === "url" ? (
            <ExternalLink className="text-[var(--os-text-muted)]" size={15} strokeWidth={2} aria-hidden />
          ) : (
            <FolderOpen className="text-[var(--os-text-muted)]" size={15} strokeWidth={2} aria-hidden />
          ),
        onClick: handleOpenAddress,
      });
    }

    return base;
  }, [
    followUpDisabled,
    handleCopy,
    handleFollowUp,
    handleOpenAddress,
    handleSearch,
    selectionAddress,
    previewApi,
    t,
  ]);

  return (
    <ChatLabContextMenu
      open={open}
      onOpenChange={handleOpenChange}
      getAnchorRect={getAnchorRect}
      items={items}
      ariaLabel={t("chatLab.selectionToolbarAria")}
      placement={placement}
      flipFallbackPlacements={flipFallbackPlacements}
      scrollRootRef={scrollContainerRef}
      ignoreDocumentDismissMs={300}
    />
  );
}
