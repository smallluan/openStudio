import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import LogoMarkIcon from "../assets/svg/LogoMarkIcon.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { cn } from "../ui/cn.js";

/**
 * First-run full-screen gate (Electron only): sync OpenClaw workspace files,
 * connect to the gateway with startup-sidecar retries, then call
 * `tools.catalog` plus `tools.effective` (plus `sessions.create`) so the heavy
 * `createOpenClawCodingTools` path runs **before** the main shell is shown.
 * No chat traffic and no provider billing — only documented gateway RPCs.
 */
export default function StartupBootstrapGate({ children }) {
  const { t } = useI18n();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const isElectron = Boolean(bridge?.bootstrapGateway);

  const [gateDone, setGateDone] = useState(!isElectron);
  const [phase, setPhase] = useState(/** @type {string} */ ("idle"));
  const [failure, setFailure] = useState(/** @type {string | null} */ (null));
  /** Increment to re-run the bootstrap sequence (retry button). */
  const [bootPass, setBootPass] = useState(0);

  const progressFrac = useMemo(() => {
    switch (phase) {
      case "config_synced":
        return 0.18;
      case "gateway_connect":
        return 0.32;
      case "tools_catalog":
        return 0.48;
      case "session_ensure":
        return 0.58;
      case "tools_effective":
        return 0.82;
      case "gateway_ready":
        return 0.94;
      case "skipped_no_gateway":
      case "complete":
        return 1;
      default:
        return 0.08;
    }
  }, [phase]);

  useEffect(() => {
    if (!isElectron) return undefined;

    try {
      if (sessionStorage.getItem("openstudio_bootstrap_skipped") === "1") {
        setGateDone(true);
        return undefined;
      }
    } catch {
      /* ignore */
    }

    let cancelled = false;
    /** @type {(() => void) | undefined} */
    let progressOff;

    async function runBoot() {
      setFailure(null);
      setPhase("idle");
      try {
        progressOff = bridge.onBootstrapProgress?.((p) => {
          if (cancelled || !p || typeof p !== "object") return;
          if (typeof p.phase === "string") setPhase(p.phase);
        });

        const result = await bridge.bootstrapGateway();
        if (cancelled) return;
        if (!result?.ok) {
          setFailure(result?.message ? String(result.message) : t("bootstrap.unknownError"));
          return;
        }
        setGateDone(true);
      } catch (e) {
        if (!cancelled) {
          setFailure(String(e?.message ?? e));
        }
      } finally {
        progressOff?.();
      }
    }

    void runBoot();

    return () => {
      cancelled = true;
      progressOff?.();
    };
  }, [bridge, bootPass, isElectron, t]);

  const phaseLine = useMemo(() => {
    switch (phase) {
      case "config_synced":
        return t("bootstrap.phase.configSync");
      case "gateway_connect":
        return t("bootstrap.phase.connect");
      case "tools_catalog":
        return t("bootstrap.phase.toolsCatalog");
      case "session_ensure":
        return t("bootstrap.phase.sessionEnsure");
      case "tools_effective":
        return t("bootstrap.phase.toolsEffective");
      case "gateway_ready":
        return t("bootstrap.phase.ready");
      case "skipped_no_gateway":
        return t("bootstrap.phase.skippedNoGateway");
      case "error":
        return t("bootstrap.phase.error");
      default:
        return t("bootstrap.phase.starting");
    }
  }, [phase, t]);

  if (gateDone) {
    return children;
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-[1000] flex flex-col overflow-hidden bg-[#f8f9fd]",
        "text-[color:var(--os-text)]",
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[42vh] opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 50% -20%, rgba(120, 170, 255, 0.28), transparent 55%)",
        }}
      />

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col items-center px-6 py-14">
        <div className="flex w-full max-w-md flex-col items-center text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.06]">
            <LogoMarkIcon className="h-10 w-10 text-[#c45c2e]" />
          </div>
          <h1 className="text-balance text-xl font-semibold tracking-tight text-[color:var(--os-text)]">
            {t("bootstrap.title")}
          </h1>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-[var(--os-text-muted)]">
            {t("bootstrap.subtitle")}
          </p>

          <div className="mt-8 w-full">
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.07]">
              <div
                className="h-full rounded-full bg-[color:var(--os-text)] transition-[width] duration-500 ease-out"
                style={{ width: `${Math.round(progressFrac * 100)}%` }}
              />
            </div>
            <p className="mt-3 min-h-[2.75rem] text-pretty text-xs leading-relaxed text-[var(--os-text-muted)]">
              {failure ?? phaseLine}
            </p>
            {failure && /gateway_unreachable/i.test(failure) ? (
              <p className="mt-2 text-pretty text-[0.75rem] leading-relaxed text-[var(--os-text-muted)]">
                {t("bootstrap.gatewayUnreachableHint")}
              </p>
            ) : null}
          </div>

          {failure ? (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                className="rounded-full bg-[color:var(--os-text)] px-5 py-2.5 text-sm font-medium text-[color:var(--os-bg)] shadow-sm transition hover:opacity-90"
                onClick={() => {
                  try {
                    sessionStorage.removeItem("openstudio_bootstrap_skipped");
                  } catch {
                    /* ignore */
                  }
                  setBootPass((n) => n + 1);
                }}
              >
                {t("bootstrap.retry")}
              </button>
              <Link
                to="/settings"
                className="rounded-full border border-black/10 bg-white px-5 py-2.5 text-sm font-medium text-[color:var(--os-text)] shadow-sm transition hover:bg-black/[0.03]"
              >
                {t("bootstrap.openSettings")}
              </Link>
              <button
                type="button"
                className="rounded-full border border-dashed border-black/20 bg-transparent px-5 py-2.5 text-sm font-medium text-[var(--os-text-muted)] transition hover:border-black/35 hover:text-[color:var(--os-text)]"
                onClick={() => {
                  try {
                    sessionStorage.setItem("openstudio_bootstrap_skipped", "1");
                  } catch {
                    /* ignore */
                  }
                  setGateDone(true);
                }}
              >
                {t("bootstrap.skipEnter")}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative z-[1] flex shrink-0 justify-center px-4 pb-8 pt-2">
        <div
          className="max-w-xl rounded-full border border-white/40 px-5 py-3 text-center text-xs leading-relaxed shadow-sm backdrop-blur-md"
          style={{
            background: "linear-gradient(105deg, rgba(186, 220, 255, 0.55), rgba(255, 210, 230, 0.45))",
          }}
        >
          {t("bootstrap.banner")}
        </div>
      </div>
    </div>
  );
}
