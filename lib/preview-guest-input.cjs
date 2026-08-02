/**
 * Browser-level input for preview/Web Explore guest webContents.
 *
 * Unlike DOM dispatch/executeJavaScript, sendInputEvent is injected by
 * Chromium's input pipeline and is suitable for pages that require trusted
 * pointer/mouse events.
 */

"use strict";

/**
 * @param {Record<string, unknown>} payload
 * @returns {Promise<Record<string, unknown>>}
 */
async function handleGuestMouseClick(payload = {}) {
  const guestId = Number(payload.webContentsId ?? payload.guestId ?? 0);
  const x = Number(payload.x);
  const y = Number(payload.y);
  if (!Number.isFinite(guestId) || guestId <= 0) {
    return { ok: false, error: "missing_guest_id" };
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: "invalid_coordinates" };
  }

  let wc = null;
  try {
    const { webContents } = require("electron");
    wc = webContents.fromId(Math.floor(guestId));
  } catch {
    wc = null;
  }
  if (!wc || wc.isDestroyed?.()) {
    return { ok: false, error: "guest_not_found", guestId: Math.floor(guestId) };
  }

  const button = payload.button === "right" ? "right" : payload.button === "middle" ? "middle" : "left";
  const clickCount = Math.max(1, Math.min(3, Math.floor(Number(payload.clickCount) || 1)));
  try {
    wc.focus?.();
    wc.sendInputEvent({ type: "mouseMove", x, y });
    wc.sendInputEvent({ type: "mouseDown", x, y, button, clickCount });
    wc.sendInputEvent({ type: "mouseUp", x, y, button, clickCount });
    return {
      ok: true,
      action: "measure-click",
      guestId: Math.floor(guestId),
      x,
      y,
      button,
      clickCount,
      inputSource: "webContents.sendInputEvent",
    };
  } catch (error) {
    return {
      ok: false,
      error: "input_dispatch_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  handleGuestMouseClick,
};
