import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import heroAvatarLight from "../assets/images/hero-avatar-light.png";
import { useI18n } from "../context/I18nContext.jsx";
import { cn } from "../ui/cn.js";

/**
 * First-run full-screen gate (Electron only): sync OpenClaw workspace files,
 * then connect to the gateway. Tool/session prep runs later on first chat.
 */
export default function StartupBootstrapGate({ children }) {
  const { t } = useI18n();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const isElectron = Boolean(bridge?.bootstrapGateway);

  const [gateDone, setGateDone] = useState(!isElectron);
  const [phase, setPhase] = useState(/** @type {string} */ ("idle"));
  const [failure, setFailure] = useState(/** @type {string | null} */ (null));
  const [bootPass, setBootPass] = useState(0);

  const progressFrac = useMemo(() => {
    switch (phase) {
      case "config_synced":
        return 0.35;
      case "gateway_connect":
        return 0.65;
      case "gateway_ready":
      case "skipped_no_gateway":
      case "complete":
        return 1;
      default:
        return 0.15;
    }
  }, [phase]);

  const failureDisplay = useMemo(() => {
    if (!failure) return null;
    if (/gateway_missing_operator_scope/i.test(failure)) return t("chatLab.gatewayMissingOperatorScope");
    return failure;
  }, [failure, t]);

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
          const failureMsg = result?.message ? String(result.message) : t("bootstrap.unknownError");
          bridge.logRendererMessage?.({ level: "error", message: `bootstrap_gate: ${failureMsg}` });
          setFailure(failureMsg);
          return;
        }
        setGateDone(true);
      } catch (e) {
        if (!cancelled) {
          const msg = String(e?.message ?? e);
          bridge.logRendererMessage?.({ level: "error", message: `bootstrap_gate_throw: ${msg}` });
          setFailure(msg);
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

  if (gateDone) {
    return children;
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-[1000] flex flex-col items-center justify-center overflow-hidden bg-[#f8f9fd]",
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

      <div className="relative z-[1] flex w-full max-w-sm flex-col items-center px-6 text-center">
        <div className="mb-6 h-24 w-24">
          <img
            className="h-full w-full object-contain"
            src={heroAvatarLight}
            alt=""
            aria-hidden
          />
        </div>
        <h1 className="text-balance text-xl font-semibold tracking-tight">
          {t("bootstrap.title")}
        </h1>

        <div className="mt-8 w-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07]">
            <div
              className="h-full rounded-full bg-[color:var(--os-text)] transition-[width] duration-500 ease-out"
              style={{ width: `${Math.round(progressFrac * 100)}%` }}
            />
          </div>
          {failureDisplay ? (
            <p className="mt-4 text-pretty text-xs leading-relaxed text-[var(--os-text-muted)]">
              {failureDisplay}
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
              className="rounded-full border border-black/10 bg-white px-5 py-2.5 text-sm font-medium text-[var(--os-text-muted)] transition hover:bg-black/[0.03] hover:text-[color:var(--os-text)]"
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
  );
}
