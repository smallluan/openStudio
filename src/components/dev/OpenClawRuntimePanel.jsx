import { useEffect, useState } from "react";

export default function OpenClawRuntimePanel({ defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [runtime, setRuntime] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await window.openclawBridge?.getRuntime?.();
        if (!cancelled) setRuntime(data ?? null);
      } catch {
        if (!cancelled) setRuntime({ error: "无法读取 OpenClaw 运行时信息" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <aside className="dev-panel">
      <button
        type="button"
        className="dev-panel__toggle btn-ghost"
        onClick={() => setOpen((v) => !v)}
      >
        OpenClaw 运行时 {open ? "▾" : "▸"}
      </button>
      {open ? (
        <div className="oc-card dev-panel__body">
          <h2>OpenClaw 接入状态</h2>
          {!runtime && <p className="muted">正在加载…</p>}
          {runtime?.error && <p className="warn">{String(runtime.error)}</p>}
          {runtime && (
            <>
              <dl className="oc-dl">
                <dt>npm 包版本</dt>
                <dd>{runtime.meta?.version ?? "（未解析）"}</dd>
                <dt>主进程 Node</dt>
                <dd>{runtime.processVersions?.node ?? "—"}</dd>
                <dt>库导出</dt>
                <dd>
                  {runtime.lib?.error
                    ? `失败：${runtime.lib.error}`
                    : `${runtime.lib?.exportCount ?? 0}`}
                </dd>
              </dl>
              {runtime.lib?.exports?.length > 0 ? (
                <details className="oc-details">
                  <summary>导出名称</summary>
                  <pre className="oc-pre">{runtime.lib.exports.join(", ")}</pre>
                </details>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
}
