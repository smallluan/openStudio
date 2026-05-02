import { matchPath, NavLink, useLocation } from "react-router-dom";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";

/** @param {*} item */
function isNavGroup(item) {
  return Boolean(item && item.kind === "group" && Array.isArray(item.items));
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

export default function FluidNavMenu({
  narrow = false,
  router = true,
  selectedId: controlledSelectedId,
  onSelect,
  primaryItems,
  footerItems = [],
  primaryTrackClassName,
  footerTrackClassName,
  className,
  afterPrimary = null,
}) {
  const { t } = useI18n();
  const location = useLocation();
  const rootRef = useRef(null);
  const itemRefs = useRef(new Map());

  const activeId = useMemo(() => {
    if (!router) return controlledSelectedId ?? null;
    return resolveRouterActiveId(location, primaryItems, footerItems);
  }, [router, controlledSelectedId, location, primaryItems, footerItems]);

  const setItemRef = useCallback((id, node) => {
    const m = itemRefs.current;
    if (node) m.set(id, node);
    else m.delete(id);
  }, []);

  const [blob, setBlob] = useState({ left: 0, top: 0, width: 0, height: 0, opacity: 0 });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !activeId) {
      setBlob((b) => ({ ...b, opacity: 0 }));
      return;
    }
    const el = itemRefs.current.get(activeId);
    if (!el) {
      setBlob((b) => ({ ...b, opacity: 0 }));
      return;
    }

    const measure = () => {
      const r = root.getBoundingClientRect();
      const e = el.getBoundingClientRect();
      const left = Math.round((e.left - r.left + root.scrollLeft) * 100) / 100;
      const top = Math.round((e.top - r.top + root.scrollTop) * 100) / 100;
      const width = Math.round(e.width * 100) / 100;
      const height = Math.round(e.height * 100) / 100;
      setBlob((prev) => {
        if (
          prev.opacity === 1 &&
          prev.left === left &&
          prev.top === top &&
          prev.width === width &&
          prev.height === height
        ) {
          return prev;
        }
        return { left, top, width, height, opacity: 1 };
      });
    };

    measure();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    ro?.observe(el);

    const onScroll = () => measure();
    root.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      ro?.disconnect();
      root.removeEventListener("scroll", onScroll);
    };
  }, [activeId, narrow, router, controlledSelectedId, location.pathname, location.search]);

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
          <div key={item.id} ref={(node) => setItemRef(item.id, node)} className="fluid-nav__measure">
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

      const shellClass = cn(hitCn, activeId === item.id && "fluid-nav__hit--active");

      return (
        <div key={item.id} ref={(node) => setItemRef(item.id, node)} className="fluid-nav__measure">
          <button
            type="button"
            className={shellClass}
            title={item.title}
            aria-current={activeId === item.id ? "page" : undefined}
            onClick={() => onSelect?.(item.id)}
          >
            {content}
          </button>
        </div>
      );
    },
    [activeId, location, narrow, onSelect, router, setItemRef],
  );

  const footer =
    footerItems?.length > 0 ? (
      <nav className={cn("fluid-nav__track fluid-nav__track--footer relative z-[1]", footerTrackClassName)} aria-label={t("nav.footerAria")}>
        {footerItems.map((item) => renderLeafItem(item, false))}
      </nav>
    ) : null;

  return (
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
      {footer ? <div className="relative z-[1] mt-auto shrink-0">{footer}</div> : null}
    </div>
  );
}
