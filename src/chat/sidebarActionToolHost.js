/**
 * Renderer-side registry for native OpenClaw `sidebar_action` tool requests.
 * ChatLabPreviewProvider hosts register an executor; a single IPC subscription dispatches here.
 */

/** @type {((args: { steps?: unknown }) => Promise<unknown>) | null} */
let executor = null;

/** @type {boolean} */
let ipcBound = false;

/**
 * @param {(args: { steps?: unknown }) => Promise<unknown>} fn
 * @returns {() => void}
 */
export function registerSidebarActionToolExecutor(fn) {
  executor = fn;
  ensureSidebarActionToolIpcBound();
  return () => {
    if (executor === fn) executor = null;
  };
}

/**
 * @param {{ steps?: unknown }} args
 */
export async function runSidebarActionToolRequest(args) {
  if (!executor) {
    return {
      ok: false,
      error: "no_preview_handler",
      message: "No Chat Lab / Web Explore preview is ready for sidebar_action",
    };
  }
  try {
    return await executor(args);
  } catch (e) {
    return {
      ok: false,
      error: "executor_threw",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

function ensureSidebarActionToolIpcBound() {
  if (ipcBound) return;
  const bridge = typeof window !== "undefined" ? window.studioBridge : null;
  if (!bridge?.onSidebarActionToolRequest || !bridge?.respondSidebarActionTool) return;
  ipcBound = true;
  bridge.onSidebarActionToolRequest(async (payload) => {
    const id = String(payload?.id ?? "").trim();
    if (!id) return;
    try {
      const result = await runSidebarActionToolRequest({
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
}
