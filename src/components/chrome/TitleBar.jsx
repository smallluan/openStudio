import { useCallback, useEffect, useState } from "react";
import { Button } from "@open-studio/udesign";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";

function WinIconMinimize({ className }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2 6h8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function WinIconMaximize({ className }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="2.35" y="2.85" width="7.3" height="6.35" rx="0.85" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function WinIconRestore({ className }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="3.15" y="3.35" width="5.35" height="5.1" rx="0.7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.85 3h4.45a.75.75 0 01.75.75v3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function WinIconClose({ className }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

export default function TitleBar() {
  const { t } = useI18n();
  const shell = typeof window !== "undefined" ? window.electronShell : null;
  const [maximized, setMaximized] = useState(false);

  const syncMax = useCallback(() => {
    if (!shell?.isMaximized) return;
    shell.isMaximized().then(setMaximized);
  }, [shell]);

  useEffect(() => {
    syncMax();
    window.addEventListener("resize", syncMax);
    return () => window.removeEventListener("resize", syncMax);
  }, [syncMax]);

  const onMinimize = () => shell?.minimize?.();
  const onToggleMax = async () => {
    await shell?.toggleMaximize?.();
    syncMax();
  };
  const onClose = () => shell?.close?.();

  return (
    <header className={cn("os-titlebar flex shrink-0 items-stretch overflow-hidden pr-0")} style={{ height: "var(--os-titlebar-height)" }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 items-stretch">
          {!shell ? (
            <span className="flex flex-1 items-center px-3 py-1 text-[0.68rem] font-medium text-[var(--os-rail-text-muted)]">
              {t("titlebar.browserPreviewHint")}
            </span>
          ) : (
            <div className="min-h-0 min-w-0 flex-1" style={{ WebkitAppRegion: "drag" }} aria-hidden />
          )}
          {shell ? (
            <div className="flex h-full shrink-0 items-stretch" style={{ WebkitAppRegion: "no-drag" }}>
              <Button type="button" className="os-titlebar__btn" aria-label={t("titlebar.minimize")} onClick={onMinimize}>
                <WinIconMinimize className="opacity-85" />
              </Button>
              <Button
                type="button"
                className="os-titlebar__btn"
                aria-label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
                onClick={onToggleMax}
              >
                {maximized ? <WinIconRestore className="opacity-85" /> : <WinIconMaximize className="opacity-85" />}
              </Button>
              <Button
                type="button"
                className="os-titlebar__btn os-titlebar__btn--close"
                aria-label={t("titlebar.close")}
                onClick={onClose}
              >
                <WinIconClose className="opacity-95" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
