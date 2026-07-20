import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";

const STORAGE_KEY = "openstudio_theme";

function readStoredTheme() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function getInitialTheme() {
  return readStoredTheme() ?? "light";
}

function applyThemeToDocument(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // TDesign tokens switch on `theme-mode` / `.dark`, not `data-theme`.
  root.setAttribute("theme-mode", theme);
  root.classList.toggle("dark", theme === "dark");
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  useLayoutEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    const v = next === "light" ? "light" : "dark";
    setThemeState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((t) => {
      const v = t === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(STORAGE_KEY, v);
      } catch {
        /* ignore */
      }
      return v;
    });
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Apply stored theme before first paint so TDesign tokens match on boot.
try {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") applyThemeToDocument(stored);
} catch {
  /* ignore */
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
