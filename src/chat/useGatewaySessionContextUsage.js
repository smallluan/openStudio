import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Poll gateway session context usage (same data source as openclaw session_status).
 *
 * @param {{
 *   bridge: { getSessionContextUsage?: (payload: { sessionKey: string }) => Promise<{ ok?: boolean; usage?: unknown }> } | null | undefined;
 *   sessionKey: string;
 *   enabled?: boolean;
 *   refreshKey?: string | number;
 * }} opts
 */
export function useGatewaySessionContextUsage({ bridge, sessionKey, enabled = true, refreshKey = 0 }) {
  const [usage, setUsage] = useState(/** @type {null | { usedTokens: number; contextWindow: number; frac: number }} */ (null));
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const key = String(sessionKey ?? "").trim();
    if (!enabled || !key || typeof bridge?.getSessionContextUsage !== "function") {
      setUsage(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    try {
      const res = await bridge.getSessionContextUsage({ sessionKey: key });
      if (requestId !== requestIdRef.current) return;
      if (res?.ok && res.usage && typeof res.usage === "object") {
        const row = /** @type {Record<string, unknown>} */ (res.usage);
        const usedTokens = Number(row.usedTokens);
        const contextWindow = Number(row.contextWindow);
        const frac = Number(row.frac);
        if (
          Number.isFinite(usedTokens) &&
          usedTokens >= 0 &&
          Number.isFinite(contextWindow) &&
          contextWindow > 0 &&
          Number.isFinite(frac)
        ) {
          setUsage({
            usedTokens: Math.round(usedTokens),
            contextWindow: Math.round(contextWindow),
            frac: Math.min(1, Math.max(0, frac)),
          });
          return;
        }
      }
      setUsage(null);
    } catch {
      if (requestId === requestIdRef.current) setUsage(null);
    }
  }, [bridge, enabled, sessionKey]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { usage, refresh };
}
