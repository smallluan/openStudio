import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

const SIDEBAR_KEY = "openstudio_sidebar_collapsed";

function IconStudio({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        fill="currentColor"
        fillOpacity=".92"
        d="M4 17V8a2 2 0 012-2h12a2 2 0 012 2v9l-8-3.5L4 17zm14-9H6v7.06l6-2.625 6 2.625V8z"
      />
      <path fill="currentColor" fillOpacity=".45" d="M8 9h8v2H8V9zm0 3.5h5v2H8v-2z" />
    </svg>
  );
}

function IconLobster({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse cx="12" cy="13" rx="5.5" ry="4.2" fill="currentColor" fillOpacity=".9" />
      <path stroke="currentColor" strokeOpacity=".85" strokeWidth="1.2" strokeLinecap="round" fill="none" d="M6.8 13.8c-.8-.6-1.3-2-1-3.6M17.4 13.8c.8-.6 1.3-2 1-3.6" />
      <path fill="currentColor" fillOpacity=".55" d="M9 11.8h2v1.2H9v-1.2zm3.2 0H14v1.2h-1.8v-1.2z" />
      <circle cx="8.9" cy="17.8" r="1.1" fill="currentColor" fillOpacity=".5" />
      <circle cx="15.2" cy="17.8" r="1.1" fill="currentColor" fillOpacity=".5" />
    </svg>
  );
}

function IconGear({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function IconCollapse({ collapsed }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {collapsed ? (
        <path d="M9.3 17.7l5-6-5-6-1 1 4.35 5-4.35 5 1 1zm-5.15-12h1.55v14.05H4.15V5.7z" />
      ) : (
        <path d="M14.7 17.7l5-6-5-6-1 1 4.35 5-4.35 5 1 1zm-10.85-12h1.55v14.05H3.85V5.7zM8.95 17.05V6.95L6 12l2.95 5.05z" />
      )}
    </svg>
  );
}

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return (
    <div className="app-frame">
      <aside className={`primary-rail ${collapsed ? "primary-rail--collapsed" : ""}`} aria-label="主导航">
        <div className="primary-rail__top">
          <button
            type="button"
            className="primary-rail__collapse"
            onClick={toggle}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!collapsed}
          >
            <IconCollapse collapsed={collapsed} />
          </button>

          <nav className="primary-rail__nav" aria-label="应用模块">
            <NavLink to="/" end className="primary-rail__link" title="工作室">
              <IconStudio className="primary-rail__icon" />
              <span className="primary-rail__label">工作室</span>
            </NavLink>
            <NavLink to="/lobster" className="primary-rail__link" title="龙虾管理">
              <IconLobster className="primary-rail__icon" />
              <span className="primary-rail__label">龙虾管理</span>
            </NavLink>
          </nav>
        </div>

        <nav className="primary-rail__bottom" aria-label="系统">
          <NavLink to="/settings" className="primary-rail__link" title="设置">
            <IconGear className="primary-rail__icon" />
            <span className="primary-rail__label">设置</span>
          </NavLink>
        </nav>
      </aside>

      <div className="app-frame__content">
        <Outlet />
      </div>
    </div>
  );
}
