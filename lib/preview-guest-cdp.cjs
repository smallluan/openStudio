/**
 * Shared CDP session for preview / Web Explore guest webContents.
 * Coordinates Network (capture) and Debugger (breakpoint) domains on one attach.
 */

"use strict";

/** @type {{ info?: Function; warn?: Function; error?: Function } | null} */
let log = null;

/** @type {import("electron").WebContents | null} */
let attachedWc = null;

/** @type {boolean} */
let networkEnabled = false;
/** @type {boolean} */
let debuggerEnabled = false;

/** @type {Set<(method: string, params: unknown, wc: import("electron").WebContents) => void | Promise<void>>} */
const messageHandlers = new Set();

/**
 * @param {{ info?: Function; warn?: Function; error?: Function } | null | undefined} logger
 */
function initPreviewGuestCdp(logger) {
  log = logger ?? null;
}

/**
 * @param {(method: string, params: unknown, wc: import("electron").WebContents) => void | Promise<void>} fn
 * @returns {() => void}
 */
function registerCdpMessageHandler(fn) {
  messageHandlers.add(fn);
  return () => messageHandlers.delete(fn);
}

/**
 * @param {import("electron").WebContents} wc
 */
async function ensureCdpAttached(wc) {
  if (!wc || wc.isDestroyed?.()) {
    return { ok: false, error: "no_guest", message: "Guest webContents is not available" };
  }
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
    }
  } catch (e) {
    log?.warn?.("[preview-guest-cdp] debugger.attach failed:", e?.message ?? e);
    return {
      ok: false,
      error: "attach_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  if (attachedWc !== wc) {
    try {
      wc.debugger.removeAllListeners("message");
    } catch {
      /* ignore */
    }
    wc.debugger.on("message", (_event, method, params) => {
      for (const handler of messageHandlers) {
        try {
          void handler(method, params, wc);
        } catch (e) {
          log?.warn?.("[preview-guest-cdp] handler error:", e?.message ?? e);
        }
      }
    });
    attachedWc = wc;
  }

  return { ok: true, attached: true, guestId: wc.id };
}

/**
 * @param {import("electron").WebContents} wc
 * @param {string} method
 * @param {Record<string, unknown>} [params]
 */
async function sendCdpCommand(wc, method, params = {}) {
  const attach = await ensureCdpAttached(wc);
  if (!attach.ok) return attach;
  try {
    const result = await wc.debugger.sendCommand(method, params);
    return { ok: true, result };
  } catch (e) {
    return {
      ok: false,
      error: "cdp_command_failed",
      method,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {import("electron").WebContents} wc
 */
async function enableCdpNetwork(wc) {
  if (networkEnabled && attachedWc === wc) {
    return { ok: true, networkEnabled: true };
  }
  const attach = await ensureCdpAttached(wc);
  if (!attach.ok) return attach;
  try {
    await wc.debugger.sendCommand("Network.enable");
    networkEnabled = true;
    return { ok: true, networkEnabled: true };
  } catch (e) {
    log?.warn?.("[preview-guest-cdp] Network.enable failed:", e?.message ?? e);
    return {
      ok: false,
      error: "network_enable_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {import("electron").WebContents} wc
 */
async function enableCdpDebugger(wc) {
  if (debuggerEnabled && attachedWc === wc) {
    return { ok: true, debuggerEnabled: true };
  }
  const attach = await ensureCdpAttached(wc);
  if (!attach.ok) return attach;
  try {
    await wc.debugger.sendCommand("Debugger.enable");
    debuggerEnabled = true;
    return { ok: true, debuggerEnabled: true };
  } catch (e) {
    log?.warn?.("[preview-guest-cdp] Debugger.enable failed:", e?.message ?? e);
    return {
      ok: false,
      error: "debugger_enable_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Disable + enable Debugger so Chromium re-emits scriptParsed for already-loaded scripts.
 * @param {import("electron").WebContents} wc
 */
async function forceEnableCdpDebugger(wc) {
  const attach = await ensureCdpAttached(wc);
  if (!attach.ok) return attach;
  try {
    try {
      await wc.debugger.sendCommand("Debugger.disable");
    } catch {
      /* ignore */
    }
    debuggerEnabled = false;
    await wc.debugger.sendCommand("Debugger.enable");
    debuggerEnabled = true;
    return { ok: true, debuggerEnabled: true, forced: true };
  } catch (e) {
    log?.warn?.("[preview-guest-cdp] Debugger force-enable failed:", e?.message ?? e);
    return {
      ok: false,
      error: "debugger_enable_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

function isCdpNetworkEnabled() {
  return networkEnabled;
}

function isCdpDebuggerEnabled() {
  return debuggerEnabled;
}

/**
 * @param {import("electron").WebContents | null | undefined} wc
 */
function detachCdpIfIdle(wc) {
  if (networkEnabled || debuggerEnabled) return { ok: true, detached: false };
  const target = wc && !wc.isDestroyed?.() ? wc : attachedWc;
  if (!target || target.isDestroyed?.()) {
    attachedWc = null;
    return { ok: true, detached: false };
  }
  try {
    if (target.debugger.isAttached()) {
      target.debugger.removeAllListeners("message");
      target.debugger.detach();
    }
  } catch {
    /* ignore */
  }
  attachedWc = null;
  return { ok: true, detached: true };
}

/**
 * @param {import("electron").WebContents | null | undefined} wc
 */
async function disableCdpNetwork(wc) {
  networkEnabled = false;
  return detachCdpIfIdle(wc);
}

/**
 * @param {import("electron").WebContents | null | undefined} wc
 */
async function disableCdpDebugger(wc) {
  debuggerEnabled = false;
  return detachCdpIfIdle(wc);
}

/**
 * Reset session flags when guest is destroyed.
 */
function resetCdpSession() {
  networkEnabled = false;
  debuggerEnabled = false;
  attachedWc = null;
}

module.exports = {
  initPreviewGuestCdp,
  registerCdpMessageHandler,
  ensureCdpAttached,
  sendCdpCommand,
  enableCdpNetwork,
  enableCdpDebugger,
  forceEnableCdpDebugger,
  disableCdpNetwork,
  disableCdpDebugger,
  detachCdpIfIdle,
  isCdpNetworkEnabled,
  isCdpDebuggerEnabled,
  resetCdpSession,
};
