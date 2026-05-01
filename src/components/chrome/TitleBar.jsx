import { useCallback, useEffect, useState } from "react";
import LogoMarkIcon from "../../assets/svg/LogoMarkIcon.jsx";
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
    <header
      className={cn(
        "os-titlebar flex shrink-0 items-center justify-between border-b border-[var(--os-border)] pl-3 pr-0",
        "bg-[var(--os-titlebar-bg)] text-[var(--os-titlebar-text)] backdrop-blur-[var(--os-blur-md)]",
      )}
      style={{ height: "var(--os-titlebar-height)", WebkitAppRegion: "drag" }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 py-1" style={{ WebkitAppRegion: "drag" }}>
        <LogoMarkIcon className="h-7 w-7 shrink-0 text-[var(--os-text)]" />
        <span className="truncate text-[0.8125rem] font-semibold tracking-tight">Open Studio</span>
      </div>

      <div className="flex h-full items-stretch" style={{ WebkitAppRegion: "no-drag" }}>
        {shell ? (
          <>
            <button type="button" className="os-titlebar__btn" aria-label="最小化" onClick={onMinimize}>
              <WinIconMinimize className="opacity-85" />
            </button>
            <button type="button" className="os-titlebar__btn" aria-label={maximized ? "还原" : "最大化"} onClick={onToggleMax}>
              {maximized ? <WinIconRestore className="opacity-85" /> : <WinIconMaximize className="opacity-85" />}
            </button>
            <button type="button" className="os-titlebar__btn os-titlebar__btn--close" aria-label="关闭" onClick={onClose}>
              <WinIconClose className="opacity-95" />
            </button>
          </>
        ) : (
          <span className="flex items-center px-3 text-[0.68rem] font-medium text-[var(--os-text-faint)]">
            浏览器预览 — 窗口控件仅在 Electron 中可用
          </span>
        )}
      </div>
    </header>
  );
}
