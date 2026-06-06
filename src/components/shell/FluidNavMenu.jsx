import { matchPath, NavLink, useLocation } from "react-router-dom";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";
import { FluidNavHighlightApi } from "./FluidNavHighlightApi.jsx";
import { useFluidBlobState } from "../../ui/useFluidBlobState.js";

/** @param {*} item */
function isNavGroup(item) {
  return Boolean(item && item.kind === "group" && Array.isArray(item.items));
}

/** @param {DOMRectReadOnly} a @param {DOMRectReadOnly} b */
function domRectsIntersect(a, b) {
  return !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);
}

function flatten(primaryItems, footerItems) {
  /** @type {*} */
  const out = [];
  for (const item of [...(primaryItems ?? []), ...(footerItems ?? [])]) {
    if (isNavGroup(item)) {
      for (const sub of item.items) out.push(sub);
    } else out.push(item);
  }
  return out;
}

/**
 * @param {import("react-router-dom").Location} location
 */
function resolveRouterActiveId(location, primaryItems, footerItems) {
  const flat = flatten(primaryItems, footerItems);
  for (const item of flat) {
    if (!item.to) continue;
    if (typeof item.isActive === "function") {
      try {
        if (item.isActive(location)) return item.id;
      } catch {
        /* ignore */
      }
      continue;
    }
    const m = matchPath({ path: item.to, end: item.end ?? false }, location.pathname);
    if (m) return item.id;
  }
  return null;
}

/**
 * @param {import("react-router-dom").Location} location
 */
function resolveFluidHighlightTargetId(location, primaryItems, footerItems, routerMode, controlledSelectedId) {
  if (!routerMode) return controlledSelectedId ?? null;
  const pathname = location.pathname;
  if (pathname === "/chat" || pathname === "/") {
    try {
      const c = new URLSearchParams(location.search).get("c");
      if (c) return `session:${c}`;
    } catch {
      /* ignore */
    }
  }
  return resolveRouterActiveId(location, primaryItems, footerItems);
}

export default function FluidNavMenu({
  narrow = false,
  router = true,
  selectedId: controlledSelectedId,
  onSelect,
  primaryItems,
  footerItems = [],
  footerAccessory = null,
  primaryTrackClassName,
  footerTrackClassName,
  className,
  afterPrimary = null,
}) {
  const { t } = useI18n();
  const location = useLocation();
  const rootRef = useRef(null);
  const anchorRefs = useRef(new Map());
  /** @type {React.MutableRefObject<Set<Element>>} */
  const nestedScrollRootsRef = useRef(new Set());

  const fluidTargetId = useMemo(
    () =>
      resolveFluidHighlightTargetId(location, primaryItems, footerItems, router, controlledSelectedId),
    [router, controlledSelectedId, location, primaryItems, footerItems],
  );

  /** Must not trigger setState on every anchor ref churn (would loop with bump → re-render → ref null,re-attach → bump). */
  const fluidTargetIdRef = useRef(fluidTargetId);
  fluidTargetIdRef.current = fluidTargetId;

  /** Latest highlight measure; registering the active anchor can queue a microtask remeasure without setState churn. */
  const blobMeasureRef = useRef(() => {});

  const [nestedScrollGeneration, setNestedScrollGeneration] = useState(0);
  const bumpNestedScroll = useCallback(() => setNestedScrollGeneration((x) => x + 1), []);

  const setFluidAnchor = useCallback(
    /** @type {(id: string, node: HTMLElement | null) => void} */
    (id, node) => {
      const m = anchorRefs.current;
      const prev = /** @type {HTMLElement | undefined} */ (m.get(id));
      if (node) {
        if (prev === node) return;
        m.set(id, node);
      } else {
        if (prev === undefined) return;
        m.delete(id);
      }
      if (fluidTargetIdRef.current === id) {
        queueMicrotask(() => {
          blobMeasureRef.current?.();
        });
      }
    },
    [],
  );

  const attachNestedScrollRoot = useCallback(
    /** @type {(node: HTMLElement | null) => (() => void) | undefined} */
    (node) => {
      if (!node) return undefined;
      nestedScrollRootsRef.current.add(node);
      bumpNestedScroll();
      return () => {
        nestedScrollRootsRef.current.delete(node);
        bumpNestedScroll();
      };
    },
    [bumpNestedScroll],
  );

  const registerSessionAnchor = useCallback(
    /** @type {(sessionId: string, node: HTMLElement | null) => void} */
    (sessionId, node) => {
      setFluidAnchor(`session:${sessionId}`, node);
    },
    [setFluidAnchor],
  );

  const highlightApi = useMemo(
    () => ({
      registerSessionAnchor,
      attachNestedScrollRoot,
    }),
    [registerSessionAnchor, attachNestedScrollRoot],
  );

  const { blob, setBlobTarget, hideBlob } = useFluidBlobState();

  useLayoutEffect(() => {
    if (!fluidTargetId) {
      hideBlob();
      blobMeasureRef.current = () => hideBlob();
      return;
    }

    const measure = () => {
      const rootLive = rootRef.current;
      const idLive = fluidTargetIdRef.current;
      const elLive = idLive ? anchorRefs.current.get(idLive) : null;
      if (!rootLive || !idLive || !elLive) {
        hideBlob();
        return;
      }
      const e = elLive.getBoundingClientRect();
      /* Chat history rows live inside nested scroll roots; hide the fluid blob when scrolled off-screen
         — otherwise translate() uses viewport deltas that sit outside the clip and look “stuck” on the rail. */
      for (const nest of nestedScrollRootsRef.current) {
        if (nest.contains(elLive)) {
          const nr = nest.getBoundingClientRect();
          if (!domRectsIntersect(e, nr)) {
            hideBlob();
            return;
          }
          break;
        }
      }
      const r = rootLive.getBoundingClientRect();
      const left = Math.round((e.left - r.left + rootLive.scrollLeft) * 100) / 100;
      const top = Math.round((e.top - r.top + rootLive.scrollTop) * 100) / 100;
      const width = Math.round(e.width * 100) / 100;
      const height = Math.round(e.height * 100) / 100;
      setBlobTarget({ left, top, width, height, opacity: 1 });
    };

    blobMeasureRef.current = measure;
    measure();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    const rootEl = rootRef.current;
    if (rootEl) ro?.observe(rootEl);

    /** @type {Element[]} */
    const nested = [...nestedScrollRootsRef.current];
    nested.forEach((s) => ro?.observe(s));

    const onNestedScroll = () => measure();

    if (rootEl) rootEl.addEventListener("scroll", measure, { passive: true });
    nested.forEach((s) => s.addEventListener("scroll", onNestedScroll, { passive: true }));

    return () => {
      ro?.disconnect();
      if (rootEl) rootEl.removeEventListener("scroll", measure);
      nested.forEach((s) => s.removeEventListener("scroll", onNestedScroll));
    };
  }, [fluidTargetId, narrow, router, controlledSelectedId, location.pathname, location.search, nestedScrollGeneration, hideBlob, setBlobTarget]);

  const footerNavPresent = Boolean(footerItems?.length > 0);
  const footerZone = footerNavPresent || footerAccessory;
  const showRailDivider = Boolean(afterPrimary && footerZone);

  /** @param {*} item */
  const renderLeafItem = useCallback(
    (item, nested = false) => {
      const content = (
        <>
          {item.icon ? (
            <span className={cn("fluid-nav__icon shrink-0", narrow && "fluid-nav__icon--narrow")}>{item.icon}</span>
          ) : null}
          <span className={cn("fluid-nav__label min-w-0", narrow && "fluid-nav__label--narrow")}>{item.label}</span>
        </>
      );

      const hitCn = cn("fluid-nav__hit", nested && "fluid-nav__hit--nested", narrow && "fluid-nav__hit--narrow");

      if (router && item.to) {
        return (
          <div key={item.id} ref={(node) => setFluidAnchor(item.id, node)} className="fluid-nav__measure">
            <NavLink
              to={item.to}
              end={item.end ?? false}
              state={item.state}
              title={item.title}
              className={({ isActive }) => {
                let active = isActive;
                if (typeof item.isActive === "function") {
                  try {
                    active = item.isActive(location);
                  } catch {
                    active = false;
                  }
                }
                return cn(hitCn, active && "fluid-nav__hit--router-active");
              }}
            >
              {content}
            </NavLink>
          </div>
        );
      }

      const shellClass = cn(hitCn, fluidTargetId === item.id && "fluid-nav__hit--active");

      return (
        <div key={item.id} ref={(node) => setFluidAnchor(item.id, node)} className="fluid-nav__measure">
          <button
            type="button"
            className={shellClass}
            title={item.title}
            aria-current={fluidTargetId === item.id ? "page" : undefined}
            onClick={() => onSelect?.(item.id)}
          >
            {content}
          </button>
        </div>
      );
    },
    [fluidTargetId, location, narrow, onSelect, router, setFluidAnchor],
  );

  return (
    <FluidNavHighlightApi.Provider value={highlightApi}>
      <div ref={rootRef} className={cn("fluid-nav-root relative flex min-h-0 flex-1 flex-col gap-2", className)}>
        <div
          aria-hidden
          className="fluid-nav__blob pointer-events-none absolute top-0 left-0 z-0 rounded-[11px]"
          style={{
            transform: `translate3d(${blob.left}px, ${blob.top}px, 0)`,
            width: `${blob.width}px`,
            height: `${blob.height}px`,
            opacity: blob.opacity,
          }}
        />
        <nav className={cn("fluid-nav__track fluid-nav__track--primary relative z-[1] shrink-0", primaryTrackClassName)} aria-label={t("nav.modulesAria")}>
          {primaryItems?.map((item) => {
            if (isNavGroup(item)) {
              return (
                <div key={item.id} className="fluid-nav__group flex min-w-0 flex-col gap-1.5">
                  <div
                    className={cn(
                      "fluid-nav__group-label flex min-w-0 items-center gap-2 px-2 py-0.5 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--os-text-faint)]",
                      narrow && "flex-col justify-center gap-1 px-1 py-1 text-center text-[0.62rem] normal-case",
                    )}
                  >
                    {item.icon ? <span className="fluid-nav__glyph shrink-0 opacity-80">{item.icon}</span> : null}
                    <span className="min-w-0 truncate">{item.label}</span>
                  </div>
                  <div
                    className={cn(
                      "fluid-nav__group-nest flex min-w-0 flex-col gap-1 border-l border-[color-mix(in_srgb,var(--os-border)_76%,transparent)] pl-3",
                      narrow && "gap-2 border-none pl-0 pt-0.5",
                    )}
                  >
                    {item.items.map((sub) => renderLeafItem(sub, true))}
                  </div>
                </div>
              );
            }
            return renderLeafItem(item, false);
          })}
        </nav>
        {afterPrimary ? (
          <div className="relative z-[1] flex min-h-0 flex-1 flex-col overflow-hidden">{afterPrimary}</div>
        ) : null}
        {showRailDivider ? <div className="fluid-nav__rail-divider shrink-0" role="presentation" aria-hidden /> : null}
        {footerZone ? (
          <div className="relative z-[1] mt-auto flex shrink-0 flex-col gap-1">
            {footerNavPresent ? (
              <nav className={cn("fluid-nav__track fluid-nav__track--footer relative z-[1]", footerTrackClassName)} aria-label={t("nav.footerAria")}>
                {footerItems.map((item) => renderLeafItem(item, false))}
              </nav>
            ) : null}
            {footerAccessory ? <div className="fluid-nav__footer-accessory">{footerAccessory}</div> : null}
          </div>
        ) : null}
      </div>
    </FluidNavHighlightApi.Provider>
  );
}
