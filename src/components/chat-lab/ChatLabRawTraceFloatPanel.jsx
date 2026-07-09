import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../ui/cn.js";

const POS_STORAGE_KEY = "openstudio_chat_raw_trace_float_pos_v1";
const OPEN_STORAGE_KEY = "openstudio_chat_raw_trace_float_open_v1";
const PANEL_W = 460;
const PANEL_H = 380;
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

/** @returns {boolean} */
function readStoredOpen() {
  try {
    return window.localStorage.getItem(OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** @param {boolean} open */
function writeStoredOpen(open) {
  try {
    window.localStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * @typedef {{
 *   id: string;
 *   streamId: string;
 *   conversationId: string;
 *   assistantMessageId: string;
 *   startedAt: number;
 *   endedAt?: number;
 *   status: "streaming" | "done" | "aborted" | "error";
 *   omittedEvents?: number;
 *   events: Array<{
 *     id: string;
 *     at: number;
 *     type: string;
 *     seq?: number;
 *     raw: Record<string, unknown>;
 *   }>;
 * }} RawTraceRound
 */

/**
 * @param {{
 *   rounds: RawTraceRound[];
 *   onClear: () => void;
 * }} props
 */
export default function ChatLabRawTraceFloatPanel({ rounds, onClear }) {
  const [open, setOpen] = useState(() => readStoredOpen());
  const [pos, setPos] = useState(() => {
    const stored = readStoredPos();
    if (stored) return stored;
    return {
      x: Math.max(MIN_X, window.innerWidth - PANEL_W - 26),
      y: Math.max(MIN_Y, window.innerHeight - PANEL_H - 72),
    };
  });
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
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

  const sortedRounds = useMemo(
    () => [...rounds].sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0)),
    [rounds],
  );

  useEffect(() => {
    if (!sortedRounds.length) {
      setSelectedRoundId("");
      setSelectedEventId("");
      return;
    }
    if (sortedRounds.some((r) => r.id === selectedRoundId)) return;
    setSelectedRoundId(sortedRounds[0].id);
  }, [selectedRoundId, sortedRounds]);

  const selectedRound = useMemo(
    () => sortedRounds.find((r) => r.id === selectedRoundId) ?? sortedRounds[0] ?? null,
    [selectedRoundId, sortedRounds],
  );

  useEffect(() => {
    if (!selectedRound?.events?.length) {
      setSelectedEventId("");
      return;
    }
    if (selectedRound.events.some((evt) => evt.id === selectedEventId)) return;
    setSelectedEventId(selectedRound.events[selectedRound.events.length - 1].id);
  }, [selectedEventId, selectedRound]);

  const selectedEvent = useMemo(() => {
    if (!selectedRound?.events?.length) return null;
    return selectedRound.events.find((evt) => evt.id === selectedEventId) ?? selectedRound.events[selectedRound.events.length - 1];
  }, [selectedEventId, selectedRound]);

  useEffect(() => {
    writeStoredOpen(open);
  }, [open]);

  useEffect(() => {
    const clampIntoViewport = () => {
      const maxX = Math.max(MIN_X, window.innerWidth - (open ? PANEL_W : 110) - 12);
      const maxY = Math.max(MIN_Y, window.innerHeight - (open ? PANEL_H : 46) - 12);
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
  }, [open]);

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.active) return;
      const width = open ? PANEL_W : 110;
      const height = open ? PANEL_H : 46;
      const maxX = Math.max(MIN_X, window.innerWidth - width - 12);
      const maxY = Math.max(MIN_Y, window.innerHeight - height - 12);
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
  }, [dragging, open]);

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

  const statusLabel = (status) => {
    if (status === "done") return "done";
    if (status === "error") return "error";
    if (status === "aborted") return "aborted";
    return "streaming";
  };

  return (
    <div
      className={cn("chat-lab-raw-trace-float", open && "chat-lab-raw-trace-float--open")}
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
    >
      {!open ? (
        <button
          type="button"
          className={cn("chat-lab-raw-trace-float__launcher", dragging && "chat-lab-raw-trace-float__launcher--dragging")}
          onPointerDown={startDrag}
          onClick={() => {
            if (dragRef.current.moved) return;
            setOpen(true);
          }}
          title="Open raw trace panel"
          aria-label="Open raw trace panel"
        >
          Raw Trace
          <span className="chat-lab-raw-trace-float__launcher-count">{sortedRounds.length}</span>
        </button>
      ) : (
        <section className="chat-lab-raw-trace-float__panel" aria-label="Raw trace panel">
          <header className="chat-lab-raw-trace-float__head" onPointerDown={startDrag}>
            <strong className="chat-lab-raw-trace-float__title">Agent Raw Trace</strong>
            <div className="chat-lab-raw-trace-float__head-actions">
              <button
                type="button"
                className="chat-lab-raw-trace-float__head-btn"
                onClick={onClear}
                disabled={sortedRounds.length === 0}
                title="Clear all captured rounds"
              >
                Clear
              </button>
              <button
                type="button"
                className="chat-lab-raw-trace-float__head-btn"
                onClick={() => setOpen(false)}
                title="Minimize panel"
              >
                _
              </button>
            </div>
          </header>

          <div className="chat-lab-raw-trace-float__filters">
            <label className="chat-lab-raw-trace-float__label" htmlFor="raw-trace-round-select">
              Round
            </label>
            <select
              id="raw-trace-round-select"
              className="chat-lab-raw-trace-float__select"
              value={selectedRound?.id ?? ""}
              onChange={(e) => {
                setSelectedRoundId(e.target.value);
                setSelectedEventId("");
              }}
            >
              {sortedRounds.length === 0 ? (
                <option value="">No rounds captured yet</option>
              ) : (
                sortedRounds.map((round, idx) => (
                  <option key={round.id} value={round.id}>
                    {`R${sortedRounds.length - idx} · ${statusLabel(round.status)} · ${round.events.length} evts`}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="chat-lab-raw-trace-float__body">
            {selectedRound ? (
              <>
                <div className="chat-lab-raw-trace-float__meta">
                  <span>{`stream: ${selectedRound.streamId}`}</span>
                  <span>{`status: ${statusLabel(selectedRound.status)}`}</span>
                  {selectedRound.omittedEvents ? (
                    <span>{`omitted: ${selectedRound.omittedEvents}`}</span>
                  ) : null}
                </div>
                <div className="chat-lab-raw-trace-float__event-list">
                  {selectedRound.events.map((evt, idx) => (
                    <button
                      key={evt.id}
                      type="button"
                      className={cn(
                        "chat-lab-raw-trace-float__event-item",
                        selectedEvent?.id === evt.id && "chat-lab-raw-trace-float__event-item--active",
                      )}
                      onClick={() => setSelectedEventId(evt.id)}
                    >
                      <span>{`${idx + 1}. ${evt.type}`}</span>
                      <span className="chat-lab-raw-trace-float__event-seq">
                        {Number.isFinite(evt.seq) ? `#${evt.seq}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
                <pre className="chat-lab-raw-trace-float__json">
                  {selectedEvent ? JSON.stringify(selectedEvent.raw, null, 2) : "{}"}
                </pre>
              </>
            ) : (
              <div className="chat-lab-raw-trace-float__empty">Waiting for stream events...</div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
