import { useEffect, useState } from "react";

/** @param {number} [intervalMs] */
export function useNowMs(intervalMs = 1000) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const ms = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 1000;
    const id = setInterval(() => setNowMs(Date.now()), ms);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}
