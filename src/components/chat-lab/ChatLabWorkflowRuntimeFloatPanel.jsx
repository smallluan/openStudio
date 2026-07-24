import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "tdesign-icons-react";
import { Button } from "@open-studio/udesign";
import { cn } from "../../ui/cn.js";
import { useI18n } from "../../context/I18nContext.jsx";
import WorkflowFlowRuntimePreview from "../workflow/WorkflowFlowRuntimePreview.jsx";

const POS_STORAGE_KEY = "openstudio_chat_workflow_runtime_float_pos_v1";
const PANEL_W = 400;
const PANEL_H = 300;
const MIN_X = 12;
const MIN_Y = 12;
const DRAG_THRESHOLD_PX = 6;

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** @returns {{ x: number; y: number } | null} */
function readStoredPos() {
  try {
    const raw = window.localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: Number(parsed.x), y: Number(parsed.y) };
  } catch {
    return null;
  }
}

/** @param {{ x: number; y: number }} pos */
function writeStoredPos(pos) {
  try {
    window.localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

/**
 * @param {{
 *   workflowName: string;
 *   nodes: import('@xyflow/react').Node[];
 *   edges: import('@xyflow/react').Edge[];
 *   runtime: import('../../workflow/workflowRuntimeRegistry.js').WorkflowSessionRuntimeState | null;
 *   liveExecution?: import('../../workflow/workflowLiveExecution.js').WorkflowLiveExecution | null;
 *   agentById: Map<string, import('../../studio/agents.js').StudioAgent>;
 *   workflows?: Array<{ id: string; name?: string }>;
 *   onClose?: () => void;
 * }} props
 */
export default function ChatLabWorkflowRuntimeFloatPanel({
  workflowName,
  nodes,
  edges,
  runtime,
  liveExecution = null,
  agentById,
  workflows = [],
  onClose,
}) {
  const { t } = useI18n();
  const [pos, setPos] = useState(() => {
    const stored = readStoredPos();
    if (stored) return stored;
    return {
      x: Math.max(MIN_X, window.innerWidth - PANEL_W - 28),
      y: Math.max(MIN_Y, 88),
    };
  });
  const [dragging, setDragging] = useState(false);
  const posRef = useRef(pos);
  posRef.current = pos;
  const dragRef = useRef(
    /** @type {{ active: boolean; moved: boolean; startX: number; startY: number; baseX: number; baseY: number }} */ ({
      active: false,
      moved: false,
      startX: 0,
      startY: 0,
      baseX: 0,
      baseY: 0,
    }),
  );

  useEffect(() => {
    const clampIntoViewport = () => {
      const maxX = Math.max(MIN_X, window.innerWidth - PANEL_W - 12);
      const maxY = Math.max(MIN_Y, window.innerHeight - PANEL_H - 12);
      setPos((prev) => {
        const next = {
          x: clamp(prev.x, MIN_X, maxX),
          y: clamp(prev.y, MIN_Y, maxY),
        };
        writeStoredPos(next);
        return next;
      });
    };
    clampIntoViewport();
    window.addEventListener("resize", clampIntoViewport);
    return () => window.removeEventListener("resize", clampIntoViewport);
  }, []);

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.active) return;
      const maxX = Math.max(MIN_X, window.innerWidth - PANEL_W - 12);
      const maxY = Math.max(MIN_Y, window.innerHeight - PANEL_H - 12);
      const nx = clamp(d.baseX + (e.clientX - d.startX), MIN_X, maxX);
      const ny = clamp(d.baseY + (e.clientY - d.startY), MIN_Y, maxY);
      if (!d.moved && Math.hypot(nx - d.baseX, ny - d.baseY) >= DRAG_THRESHOLD_PX) {
        d.moved = true;
      }
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      const d = dragRef.current;
      d.active = false;
      setDragging(false);
      writeStoredPos(posRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  /** @param {React.PointerEvent<HTMLElement>} e */
  const startDrag = (e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos.x,
      baseY: pos.y,
    };
    setDragging(true);
  };

  return (
    <div
      className={cn("chat-lab-workflow-runtime-float", dragging && "chat-lab-workflow-runtime-float--dragging")}
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      role="dialog"
      aria-label={t("chatLab.workflowRuntimeFloatAria")}
    >
      <section className="chat-lab-workflow-runtime-float__panel">
        <header
          className="chat-lab-workflow-runtime-float__head"
          onPointerDown={startDrag}
        >
          <div className="chat-lab-workflow-runtime-float__head-text">
            <span className="chat-lab-workflow-runtime-float__eyebrow">
              {t("chatLab.workflowRuntimeFloatEyebrow")}
            </span>
            <strong className="chat-lab-workflow-runtime-float__title" title={workflowName}>
              {workflowName}
            </strong>
          </div>
          {onClose ? (
            <Button
              variant="text"
              size="small"
              type="button"
              className="chat-lab-workflow-runtime-float__close"
              onClick={onClose}
              aria-label={t("chatLab.workflowRuntimeFloatClose")}
            >
              <CloseIcon />
            </Button>
          ) : null}
        </header>
        <div className="chat-lab-workflow-runtime-float__canvas" aria-hidden>
          <WorkflowFlowRuntimePreview
            nodes={nodes}
            edges={edges}
            runtime={runtime}
            liveExecution={liveExecution}
            agentById={agentById}
            workflows={workflows}
          />
        </div>
      </section>
    </div>
  );
}
