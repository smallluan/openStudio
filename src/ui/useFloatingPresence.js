import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps floating layers mounted while exit CSS plays after `open` becomes false.
 *
 * @param {boolean} open
 */
export function useFloatingPresence(open) {
  const [leaving, setLeaving] = useState(false);
  /** @type {React.MutableRefObject<boolean | null>} */
  const prevOpenRef = useRef(null);
  const surfaceKeyRef = useRef(0);

  useEffect(() => {
    const prev = prevOpenRef.current;
    if (open && prev !== true) {
      surfaceKeyRef.current += 1;
      setLeaving(false);
    } else if (!open && prev === true) {
      setLeaving(true);
    }
    prevOpenRef.current = open;
  }, [open]);

  const finishLeave = useCallback(() => {
    setLeaving(false);
  }, []);

  const present = open || leaving;

  const surfaceKey = surfaceKeyRef.current;

  useEffect(() => {
    if (!leaving) return undefined;
    const id = window.setTimeout(() => finishLeave(), 560);
    return () => window.clearTimeout(id);
  }, [leaving, finishLeave]);

  return { present, leaving, finishLeave, surfaceKey };
}
