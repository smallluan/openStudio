/**
 * Renderer-side registry for native OpenClaw browser tool requests.
 * ChatLabPreviewProvider hosts register executors; IPC subscriptions dispatch here.
 */

/** @type {((args: { steps?: unknown; domRead?: string; retainPriorPageDom?: boolean }) => Promise<unknown>) | null} */
let actionExecutor = null;
/** @type {((args: { url?: string; title?: string }) => Promise<unknown>) | null} */
let openExecutor = null;

/** @type {boolean} */
let actionIpcBound = false;
/** @type {boolean} */
let openIpcBound = false;

/**
 * @param {(args: { steps?: unknown; domRead?: string; retainPriorPageDom?: boolean }) => Promise<unknown>} fn
 * @returns {() => void}
 */
export function registerBrowserActionToolExecutor(fn) {
  actionExecutor = fn;
  ensureBrowserToolIpcBound();
  return () => {
    if (actionExecutor === fn) actionExecutor = null;
  };
}

/** @deprecated use registerBrowserActionToolExecutor */
export const registerSidebarActionToolExecutor = registerBrowserActionToolExecutor;

/**
 * @param {(args: { url?: string; title?: string }) => Promise<unknown>} fn
 * @returns {() => void}
 */
export function registerBrowserOpenToolExecutor(fn) {
  openExecutor = fn;
  ensureBrowserToolIpcBound();
  return () => {
    if (openExecutor === fn) openExecutor = null;
  };
}

/**
 * @param {{ steps?: unknown; domRead?: string; retainPriorPageDom?: boolean }} args
 */
export async function runBrowserActionToolRequest(args) {
  if (!actionExecutor) {
    return {
      ok: false,
      error: "no_preview_handler",
      message: "No Chat Lab / Web Explore preview is ready for browser_action",
    };
  }
  try {
    return await actionExecutor(args);
  } catch (e) {
    return {
      ok: false,
      error: "executor_threw",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** @deprecated use runBrowserActionToolRequest */
export const runSidebarActionToolRequest = runBrowserActionToolRequest;

/**
 * @param {{ url?: string; title?: string }} args
 */
export async function runBrowserOpenToolRequest(args) {
  if (!openExecutor) {
    return {
      ok: false,
      error: "no_preview_handler",
      message: "No Chat Lab / Web Explore preview is ready for browser_open",
    };
  }
  try {
    return await openExecutor(args);
  } catch (e) {
    return {
      ok: false,
      error: "executor_threw",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

function ensureBrowserToolIpcBound() {
  const bridge = typeof window !== "undefined" ? window.studioBridge : null;
  if (!bridge) return;

  // Bind action + open independently. A single `ipcBound` flag previously could
  // mark the module "ready" after only sidebar_action was wired (older preload /
  // HMR), so later browser_open IPC was never subscribed — tool returned timeout
  // / nothing happened in UI or system browser.
  if (
    !actionIpcBound &&
    bridge.onSidebarActionToolRequest &&
    bridge.respondSidebarActionTool
  ) {
    actionIpcBound = true;
    bridge.onSidebarActionToolRequest(async (payload) => {
      const id = String(payload?.id ?? "").trim();
      if (!id) return;
      try {
        const result = await runBrowserActionToolRequest({
          steps: payload?.steps ?? payload?.args?.steps,
          domRead: payload?.args?.domRead,
          retainPriorPageDom: payload?.args?.retainPriorPageDom === true,
        });
        await bridge.respondSidebarActionTool({ id, result });
      } catch (e) {
        await bridge.respondSidebarActionTool({
          id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }

  if (!openIpcBound && bridge.onBrowserOpenToolRequest && bridge.respondBrowserOpenTool) {
    openIpcBound = true;
    bridge.onBrowserOpenToolRequest(async (payload) => {
      const id = String(payload?.id ?? "").trim();
      if (!id) return;
      try {
        const result = await runBrowserOpenToolRequest({
          url: payload?.url,
          title: payload?.title,
        });
        await bridge.respondBrowserOpenTool({ id, result });
      } catch (e) {
        await bridge.respondBrowserOpenTool({
          id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }
}
