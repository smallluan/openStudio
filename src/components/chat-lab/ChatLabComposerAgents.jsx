import { Search, Users } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Select as TSelect } from "tdesign-react";
import { Input } from "@open-studio/udesign";
import { agentAvatarGlyph, agentDisplayLabel } from "../../studio/agents.js";
import Avatar from "../../ui/Avatar.jsx";
import { composerToolbarSelectPopupProps } from "../../ui/osPopupShared.js";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   agents: import("../../studio/agents.js").LobsterAgent[];
 *   value: string;
 *   onChange: (agentId: string) => void;
 *   disabled?: boolean;
 *   popupZIndex?: number;
 *   popupProps?: Record<string, any>;
 *   placeholder?: string;
 *   title?: string;
 *   t: (k: string) => string;
 * }} props
 */
export function ComposerAgentToolbarPicker({
  agents,
  value,
  onChange,
  disabled,
  popupZIndex = 6500,
  popupProps,
  placeholder,
  title,
  t,
}) {
  const autoId = useId();
  const listId = `${autoId}-agent-list`;
  const selectRef = useRef(/** @type {any} */ (null));
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const optionRefs = useRef(/** @type {Array<HTMLButtonElement | null>} */ ([]));
  const scrollHighlightIntoViewRef = useRef(false);

  const selected = useMemo(
    () => agents.find((a) => a.id === String(value ?? "").trim()) ?? null,
    [agents, value],
  );

  const agentOptions = useMemo(
    () => agents.map((agent) => ({ value: agent.id, label: agentDisplayLabel(agent) })),
    [agents],
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter((a) => {
      const label = agentDisplayLabel(a).toLowerCase();
      const gid = String(a.gatewayAgentId ?? "").toLowerCase();
      return label.includes(query) || gid.includes(query);
    });
  }, [agents, q]);

  useEffect(() => {
    if (!open) return;
    scrollHighlightIntoViewRef.current = true;
    const selectedIndex = filtered.findIndex((a) => a.id === String(value ?? "").trim());
    setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [q, open, filtered, value]);

  useEffect(() => {
    setHighlightIndex((i) => {
      if (filtered.length === 0) return 0;
      return Math.min(i, filtered.length - 1);
    });
  }, [filtered.length]);

  useEffect(() => {
    if (!scrollHighlightIntoViewRef.current) return;
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
    scrollHighlightIntoViewRef.current = false;
  }, [highlightIndex, filtered.length]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    setQ("");
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        selectRef.current?.update?.();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [open, q, filtered.length]);

  const pickAgent = useCallback(
    (agentId) => {
      onChange(agentId);
      setOpen(false);
      setQ("");
    },
    [onChange],
  );

  const confirmHighlighted = useCallback(() => {
    const row = filtered[highlightIndex];
    if (!row) return;
    pickAgent(row.id);
  }, [filtered, highlightIndex, pickAgent]);

  const onPopoverKeyDown = useCallback(
    /** @param {import("react").KeyboardEvent} e */
    (e) => {
      if (!open || filtered.length === 0 || e.nativeEvent.isComposing) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollHighlightIntoViewRef.current = true;
        setHighlightIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollHighlightIntoViewRef.current = true;
        setHighlightIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        confirmHighlighted();
      }
    },
    [confirmHighlighted, filtered.length, open],
  );

  const panelTopContent = (
    <div
      className="chat-lab__agent-popover"
      onKeyDown={onPopoverKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="chat-lab__agent-popover-search">
        <Input
          ref={inputRef}
          block
          borderless
          clearable
          size="small"
          type="search"
          prefixIcon={<Search size={14} aria-hidden />}
          value={q}
          onChange={(next) => setQ(next)}
          placeholder={t("chatLab.agentPickerSearch")}
          aria-label={t("chatLab.agentPickerSearch")}
        />
      </div>
      <div id={listId} role="listbox" className="chat-lab__agent-popover-list">
        {filtered.length === 0 ? (
          <div className="chat-lab__agent-popover-empty">{t("chatLab.agentPickerEmpty")}</div>
        ) : (
          filtered.map((agent, index) => (
            <button
              key={agent.id}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="option"
              aria-selected={index === highlightIndex}
              className={cn(
                "chat-lab__agent-popover-option",
                index === highlightIndex && "chat-lab__agent-popover-option--active",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickAgent(agent.id)}
            >
              <span className="chat-lab__agent-popover-option-avatar" aria-hidden>
                <Avatar
                  src={agentAvatarGlyph(agent)}
                  name={agentDisplayLabel(agent)}
                  size="xs"
                  shape="rounded"
                />
              </span>
              <span className="chat-lab__agent-popover-option-body">
                <span className="chat-lab__agent-popover-option-label">{agentDisplayLabel(agent)}</span>
                {agent.isMain ? (
                  <span className="chat-lab__agent-popover-option-badge">{t("agents.mainBadge")}</span>
                ) : null}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  const prefixIcon = selected ? (
    <Avatar
      src={agentAvatarGlyph(selected)}
      name={agentDisplayLabel(selected)}
      size="xs"
      shape="rounded"
    />
  ) : (
    <Users size={14} strokeWidth={2} aria-hidden />
  );

  return (
    <TSelect
      ref={selectRef}
      borderless
      autoWidth
      prefixIcon={prefixIcon}
      className={cn("chat-lab__pill-agent", open && "chat-lab__pill-agent--open")}
      disabled={disabled || agents.length === 0}
      title={title}
      placeholder={placeholder || t("automationPage.taskAgentPlaceholder")}
      value={selected?.id ?? ""}
      options={agentOptions}
      empty={null}
      panelTopContent={panelTopContent}
      popupVisible={open}
      onPopupVisibleChange={(visible) => {
        setOpen(visible);
        if (!visible) setQ("");
      }}
      onChange={(next) => onChange(String(next ?? ""))}
      valueDisplay={selected ? () => agentDisplayLabel(selected) : undefined}
      selectInputProps={{
        "aria-haspopup": "listbox",
        "aria-expanded": open,
        "aria-controls": open ? listId : undefined,
      }}
      popupProps={{
        ...composerToolbarSelectPopupProps(popupZIndex, "chat-lab__pill-agent-popup", 6),
        ...(popupProps ?? {}),
      }}
    />
  );
}
