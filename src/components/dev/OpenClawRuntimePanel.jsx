import { useEffect, useState } from "react";
import { Button } from "@open-studio/udesign";
import { useI18n } from "../../context/I18nContext.jsx";

export default function OpenClawRuntimePanel({ defaultOpen = false }) {
  const { t } = useI18n();
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
        if (!cancelled) setRuntime({ error: t("openclaw.readError") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  return (
    <aside className="dev-panel">
      <Button
        type="button"
        variant="text"
        className="dev-panel__toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {t("openclaw.runtimeToggle")} {open ? "▾" : "▸"}
      </Button>
      {open ? (
        <div className="oc-card dev-panel__body">
          <h2>{t("openclaw.panelTitle")}</h2>
          {!runtime && <p className="muted">{t("openclaw.loading")}</p>}
          {runtime?.error && <p className="warn">{String(runtime.error)}</p>}
          {runtime && (
            <>
              <dl className="oc-dl">
                <dt>{t("openclaw.npmVersion")}</dt>
                <dd>{runtime.meta?.version ?? t("openclaw.unparsed")}</dd>
                <dt>{t("openclaw.mainNode")}</dt>
                <dd>{runtime.processVersions?.node ?? "—"}</dd>
                <dt>{t("openclaw.libExports")}</dt>
                <dd>
                  {runtime.lib?.error
                    ? t("openclaw.libFailed", { error: String(runtime.lib.error) })
                    : `${runtime.lib?.exportCount ?? 0}`}
                </dd>
              </dl>
              {runtime.lib?.exports?.length > 0 ? (
                <details className="oc-details">
                  <summary>{t("openclaw.exportNames")}</summary>
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
