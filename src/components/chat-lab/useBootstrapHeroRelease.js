import { useLayoutEffect, useRef } from "react";

export const HERO_RELEASE_MS = 1050;

/**
 * FLIP handoff: portal hero flies to the in-layout landing hero (center-aligned, no scale).
 * @param {import("react").RefObject<HTMLElement | null>} portalHeroRef
 * @param {import("react").RefObject<HTMLElement | null>} landingHeroRef
 * @param {string} shellPhase
 */
export function useBootstrapHeroRelease(portalHeroRef, landingHeroRef, shellPhase) {
  const ranForExitRef = useRef(false);

  useLayoutEffect(() => {
    if (shellPhase !== "exiting") {
      ranForExitRef.current = false;
      return;
    }
    if (ranForExitRef.current) return;

    const el = portalHeroRef.current;
    const target = landingHeroRef.current;
    if (!el || !target) return;

    ranForExitRef.current = true;

    const first = el.getBoundingClientRect();
    const last = target.getBoundingClientRect();
    const targetLeft = last.left + (last.width - first.width) / 2;
    const targetTop = last.top + (last.height - first.height) / 2;
    const translateX = first.left - targetLeft;
    const translateY = first.top - targetTop;

    el.classList.remove("chat-lab__hero--gate-splash");
    el.classList.add("chat-lab__hero--gate-releasing");
    el.style.position = "fixed";
    el.style.left = `${targetLeft}px`;
    el.style.top = `${targetTop}px`;
    el.style.width = `${first.width}px`;
    el.style.maxWidth = `${first.width}px`;
    el.style.margin = "0";
    el.style.transform = `translate(${translateX}px, ${translateY}px)`;
    el.style.transition = "none";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = `transform ${HERO_RELEASE_MS}ms cubic-bezier(0.25, 0.9, 0.35, 1)`;
        el.style.transform = "translate(0, 0)";
      });
    });
  }, [shellPhase, portalHeroRef, landingHeroRef]);
}
