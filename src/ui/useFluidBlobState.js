import { useCallback, useEffect, useRef, useState } from "react";

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Shared liquid blob motion state:
 * - keeps regular left/top/width/height/opacity
 * - adds transient axis-aware "cohesion" (squish) while moving
 */
export function useFluidBlobState() {
  const [blob, setBlob] = useState(() => ({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    opacity: 0,
    squishX: 1,
    squishY: 1,
  }));

  const settleTimerRef = useRef(/** @type {number | null} */ (null));
  const lastUpdateAtRef = useRef(0);

  useEffect(
    () => () => {
      if (settleTimerRef.current != null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    },
    [],
  );

  const hideBlob = useCallback(() => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    setBlob((prev) => {
      if (prev.opacity === 0 && prev.squishX === 1 && prev.squishY === 1) return prev;
      return { ...prev, opacity: 0, squishX: 1, squishY: 1 };
    });
  }, []);

  const setBlobTarget = useCallback((nextRect) => {
    let shouldSettle = false;

    setBlob((prev) => {
      const next = {
        left: nextRect.left,
        top: nextRect.top,
        width: nextRect.width,
        height: nextRect.height,
        opacity: nextRect.opacity ?? 1,
      };

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const dt = now - lastUpdateAtRef.current;
      lastUpdateAtRef.current = now;

      // Keep current cohesion unless a new movement pulse is detected.
      let squishX = prev.squishX;
      let squishY = prev.squishY;

      if (prev.opacity > 0.2 && next.opacity > 0.2) {
        const dx = next.left - prev.left;
        const dy = next.top - prev.top;
        const dist = Math.hypot(dx, dy);
        const dSize = Math.abs(next.width - prev.width) + Math.abs(next.height - prev.height);
        const canPulse = dt > 90;
        const movedEnough = dist > 10 || dSize > 6;

        if (canPulse && movedEnough) {
          const intensity = clamp(dist / 56 + dSize / 96, 0, 1);
          const baseShrink = 0.07 + intensity * 0.14;
          const axisRatio = Math.max(next.width, next.height) / Math.max(1, Math.min(next.width, next.height));
          const axisBias = clamp((axisRatio - 1) * 0.1, 0, 0.11);

          if (next.width >= next.height) {
            squishX = 1 - clamp(baseShrink + axisBias, 0.06, 0.3);
            squishY = 1 - clamp(baseShrink * 0.68 + axisBias * 0.26, 0.04, 0.22);
          } else {
            squishX = 1 - clamp(baseShrink * 0.68 + axisBias * 0.26, 0.04, 0.22);
            squishY = 1 - clamp(baseShrink + axisBias, 0.06, 0.3);
          }
          shouldSettle = true;
        }
      } else if (next.opacity <= 0.2) {
        squishX = 1;
        squishY = 1;
      }

      if (
        prev.opacity === next.opacity &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height &&
        prev.squishX === squishX &&
        prev.squishY === squishY
      ) {
        return prev;
      }

      return { ...next, squishX, squishY };
    });

    if (shouldSettle) {
      if (settleTimerRef.current != null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      settleTimerRef.current = window.setTimeout(() => {
        setBlob((prev) => {
          if (prev.squishX === 1 && prev.squishY === 1) return prev;
          return { ...prev, squishX: 1, squishY: 1 };
        });
      }, 170);
    }
  }, []);

  return { blob, setBlobTarget, hideBlob };
}
