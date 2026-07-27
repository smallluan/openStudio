/**
 * Renderer-side registry for native OpenClaw browser tool requests.
 * ChatLabPreviewProvider hosts register executors; IPC subscriptions dispatch here.
 */

/** @type {((args: { steps?: unknown }) => Promise<unknown>) | null} */
let actionExecutor = null;
/** @type {((args: { url?: string; title?: string }) => Promise<unknown>) | null} */
let openExecutor = null;

/** @type {boolean} */
let ipcBound = false;

/**
 * @param {(args: { steps?: unknown }) => Promise<unknown>} fn
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
 * @param {{ steps?: unknown }} args
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
  if (ipcBound) return;
  const bridge = typeof window !== "undefined" ? window.studioBridge : null;
  if (!bridge?.onSidebarActionToolRequest || !bridge?.respondSidebarActionTool) return;
  ipcBound = true;
  bridge.onSidebarActionToolRequest(async (payload) => {
    const id = String(payload?.id ?? "").trim();
    if (!id) return;
    try {
      const result = await runBrowserActionToolRequest({
        steps: payload?.steps ?? payload?.args?.steps,
      });
      await bridge.respondSidebarActionTool({ id, result });
    } catch (e) {
      await bridge.respondSidebarActionTool({
        id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
  if (bridge.onBrowserOpenToolRequest && bridge.respondBrowserOpenTool) {
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
