import { useEffect, useState } from "react";

export default function App() {
  const title = window.appInfo?.name ?? "Open Studio";
  const [runtime, setRuntime] = useState(null);

  useEffect(() => {
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
  }, []);

  return (
    <main className="app">
      <h1>{title}</h1>
      <p className="lead">
        基于 OpenClaw 的 Electron + React 壳。开发请运行 <code>npm run dev</code>。
      </p>

      <section className="oc-card">
        <h2>OpenClaw 接入状态</h2>
        {!runtime && <p className="muted">正在加载…</p>}
        {runtime?.error && (
          <p className="warn">{String(runtime.error)}</p>
        )}
        {runtime && !runtime.error && (
          <>
            <dl className="oc-dl">
              <dt>npm 包版本</dt>
              <dd>{runtime.meta?.version ?? "（未解析到 package.json）"}</dd>
              <dt>主进程 Node（Electron 内置）</dt>
              <dd>{runtime.processVersions?.node ?? "—"}</dd>
              <dt>库导出数量</dt>
              <dd>
                {runtime.lib?.error
                  ? `加载失败：${runtime.lib.error}`
                  : `${runtime.lib?.exportCount ?? 0}（主进程可用 dynamic import('openclaw')）`}
              </dd>
            </dl>
            {runtime.meta?.cliEntry ? (
              <p className="muted small">
                CLI 入口：<code>{runtime.meta.cliEntry}</code>
                <br />
                终端调试可执行：<code>npm run openclaw -- --help</code>
              </p>
            ) : null}
            {runtime.lib?.exports?.length > 0 ? (
              <details className="oc-details">
                <summary>库导出名称（节选）</summary>
                <pre className="oc-pre">{runtime.lib.exports.join(", ")}</pre>
              </details>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
