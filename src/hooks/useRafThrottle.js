import { useCallback, useEffect, useRef, useState } from "react";

/**
 * RAF-throttled value hook — limits UI updates to ~60fps during streaming.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function useRafThrottledValue(value) {
  const [throttledValue, setThrottledValue] = useState(value);
  const pendingRef = useRef(value);
  const rafIdRef = useRef(/** @type {number | null} */ (null));

  useEffect(() => {
    pendingRef.current = value;
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        setThrottledValue(pendingRef.current);
        rafIdRef.current = null;
      });
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  return throttledValue;
}

/**
 * @template {(...args: unknown[]) => void} T
 * @param {T} callback
 * @returns {T}
 */
export function useRafThrottledCallback(callback) {
  const pendingArgsRef = useRef(/** @type {unknown[] | null} */ (null));
  const rafIdRef = useRef(/** @type {number | null} */ (null));
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const throttledCallback = useCallback((...args) => {
    pendingArgsRef.current = args;
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingArgsRef.current !== null) {
          callbackRef.current(...pendingArgsRef.current);
        }
        pendingArgsRef.current = null;
        rafIdRef.current = null;
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  return /** @type {T} */ (throttledCallback);
}
