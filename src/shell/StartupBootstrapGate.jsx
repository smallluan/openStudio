import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BootstrapGateProvider } from "../context/BootstrapGateContext.jsx";
import { cn } from "../ui/cn.js";

import { HERO_RELEASE_MS } from "../components/chat-lab/useBootstrapHeroRelease.js";

const MIN_VISIBLE_MS = 520;
const PROGRESS_EXIT_MS = 400;
const BACKDROP_FADE_MS = 1000;
const SETTLING_MS = 120;
const BOOT_RETRY_MS = 4000;
const BOOT_RETRY_FAST_MS = 1200;

const GATE_READY_PHASES = new Set(["gateway_ready", "complete", "skipped_no_gateway"]);

/**
 * Electron bootstrap: fullscreen backdrop; hero + progress render in gatePortalEl (above backdrop).
 */
export default function StartupBootstrapGate({ children }) {
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const isElectron = Boolean(bridge?.bootstrapGateway);

  const [shellPhase, setShellPhase] = useState(isElectron ? "loading" : "ready");
  const [bootPhase, setBootPhase] = useState("idle");
  const [bootPass, setBootPass] = useState(0);
  const [progressExiting, setProgressExiting] = useState(false);
  const [gatePortalEl, setGatePortalEl] = useState(null);

  const bootPhaseRef = useRef("idle");
  const bootStartedAtRef = useRef(null);

  const onPortalRef = useCallback((el) => {
    setGatePortalEl(el);
  }, []);

  const progressFrac = useMemo(() => {
    switch (bootPhase) {
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
  }, [bootPhase]);

  const overlayActive = isElectron && shellPhase !== "ready";

  const gateContext = useMemo(
    () => ({
      shellPhase: isElectron ? shellPhase : "ready",
      bootPhase,
      landingRevealReady: !isElectron || shellPhase === "ready",
      playHeroTitleEntrance: !isElectron,
      progressFrac,
      progressExiting,
      gatePortalEl:
        isElectron && (shellPhase === "loading" || shellPhase === "exiting") ? gatePortalEl : null,
    }),
    [isElectron, shellPhase, bootPhase, progressFrac, progressExiting, overlayActive, gatePortalEl],
  );

  const beginExitTransition = (startedAt) => {
    const remain = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
    window.setTimeout(() => {
      setProgressExiting(true);
      window.setTimeout(() => {
        setShellPhase("exiting");
        window.setTimeout(() => {
          setShellPhase("settling");
        }, HERO_RELEASE_MS);
        window.setTimeout(() => {
          setShellPhase("ready");
          setProgressExiting(false);
        }, Math.max(BACKDROP_FADE_MS, HERO_RELEASE_MS + SETTLING_MS));
      }, PROGRESS_EXIT_MS);
    }, remain);
  };

  useEffect(() => {
    if (!isElectron) return undefined;

    try {
      if (sessionStorage.getItem("openstudio_bootstrap_skipped") === "1") {
        setShellPhase("ready");
        return undefined;
      }
    } catch {
      /* ignore */
    }

    let cancelled = false;
    let progressOff;
    let retryTimer;

    async function waitForGateReadyPhase(maxMs = 60000) {
      const deadline = Date.now() + maxMs;
      while (!cancelled && Date.now() < deadline) {
        if (GATE_READY_PHASES.has(bootPhaseRef.current)) return true;
        await new Promise((r) => window.setTimeout(r, 40));
      }
      return GATE_READY_PHASES.has(bootPhaseRef.current);
    }

    async function runBoot() {
      setBootPhase("idle");
      bootPhaseRef.current = "idle";
      setShellPhase("loading");
      setProgressExiting(false);
      const startedAt = Date.now();
      bootStartedAtRef.current = startedAt;

      try {
        progressOff = bridge.onBootstrapProgress?.((p) => {
          if (cancelled || !p || typeof p !== "object") return;
          if (typeof p.phase === "string") {
            bootPhaseRef.current = p.phase;
            setBootPhase(p.phase);
          }
        });

        const result = await bridge.bootstrapGateway();
        if (cancelled) return;

        if (!result?.ok) {
          const failureMsg = result?.message ? String(result.message) : "bootstrap failed";
          bridge.logRendererMessage?.({ level: "error", message: `bootstrap_gate: ${failureMsg}` });
          bootPhaseRef.current = "gateway_retrying";
          setBootPhase("gateway_retrying");
          const retryMs = /gateway_unreachable|ECONNREFUSED/i.test(failureMsg)
            ? BOOT_RETRY_FAST_MS
            : BOOT_RETRY_MS;
          retryTimer = window.setTimeout(() => {
            if (!cancelled) setBootPass((n) => n + 1);
          }, retryMs);
          return;
        }

        const ready = await waitForGateReadyPhase();
        if (cancelled) return;
        if (!ready) {
          bridge.logRendererMessage?.({
            level: "warn",
            message: "bootstrap_gate: timed out waiting for gateway_ready",
          });
          bootPhaseRef.current = "gateway_retrying";
          setBootPhase("gateway_retrying");
          retryTimer = window.setTimeout(() => {
            if (!cancelled) setBootPass((n) => n + 1);
          }, BOOT_RETRY_MS);
          return;
        }

        beginExitTransition(startedAt);
      } catch (e) {
        if (!cancelled) {
          const msg = String(e?.message ?? e);
          bridge.logRendererMessage?.({ level: "error", message: `bootstrap_gate_throw: ${msg}` });
          bootPhaseRef.current = "gateway_retrying";
          setBootPhase("gateway_retrying");
          retryTimer = window.setTimeout(() => {
            if (!cancelled) setBootPass((n) => n + 1);
          }, BOOT_RETRY_MS);
        }
      } finally {
        progressOff?.();
      }
    }

    void runBoot();

    return () => {
      cancelled = true;
      progressOff?.();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [bridge, bootPass, isElectron]);

  return (
    <BootstrapGateProvider value={gateContext}>
      <div className="bootstrap-gate-root">
        <div
          className={cn(
            "bootstrap-gate-root__app",
            overlayActive && "bootstrap-gate-root__app--masked",
          )}
          aria-hidden={overlayActive ? true : undefined}
        >
          {children}
        </div>

        {overlayActive ? (
          <>
            <div
              className={cn(
                "bootstrap-gate",
                (shellPhase === "exiting" || shellPhase === "settling") && "bootstrap-gate--exiting",
              )}
              role="status"
              aria-live="polite"
              aria-busy={shellPhase === "loading"}
            />
            <div ref={onPortalRef} className="bootstrap-gate-chrome" />
          </>
        ) : null}
      </div>
    </BootstrapGateProvider>
  );
}
