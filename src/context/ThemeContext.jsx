import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  applyBrandColorToDocument,
  BUILTIN_BRAND_PRESETS,
  isSameBrandColor,
  normalizeHex,
  readStoredBrandColor,
  resolveBrandPrimary,
  writeStoredBrandColor,
} from "../theme/brandColor.js";

const STORAGE_KEY = "openstudio_theme";

function readStoredTheme() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "light";
}

function resolveTheme(preference) {
  if (preference !== "system") return preference;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
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
  const [themePreference, setThemePreference] = useState(readStoredTheme);
  const [theme, setThemeState] = useState(() => resolveTheme(readStoredTheme()));
  const [brandColor, setBrandColorState] = useState(readStoredBrandColor);

  useEffect(() => {
    if (themePreference !== "system") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => setThemeState(media.matches ? "dark" : "light");
    updateTheme();
    media.addEventListener?.("change", updateTheme);
    return () => media.removeEventListener?.("change", updateTheme);
  }, [themePreference]);

  useLayoutEffect(() => {
    applyThemeToDocument(theme);
    applyBrandColorToDocument(theme, resolveBrandPrimary(brandColor));
  }, [theme, brandColor]);

  const setTheme = useCallback((next) => {
    const v = next === "light" || next === "dark" || next === "system" ? next : "dark";
    setThemePreference(v);
    setThemeState(resolveTheme(v));
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemePreference((preference) => {
      const t = resolveTheme(preference);
      const v = t === "light" ? "dark" : "light";
      setThemeState(v);
      try {
        window.localStorage.setItem(STORAGE_KEY, v);
      } catch {
        /* ignore */
      }
      return v;
    });
  }, []);

  const setBrandColorPreset = useCallback((presetId) => {
    const preset = BUILTIN_BRAND_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const next = { type: "preset", id: preset.id };
    setBrandColorState((current) => {
      if (isSameBrandColor(current, next)) return current;
      writeStoredBrandColor(next);
      return next;
    });
  }, []);

  const setCustomBrandColor = useCallback((hex) => {
    const color = normalizeHex(hex);
    if (!color) return;
    const next = { type: "custom", color };
    setBrandColorState((current) => {
      if (isSameBrandColor(current, next)) return current;
      writeStoredBrandColor(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      theme,
      themePreference,
      setTheme,
      toggleTheme,
      brandColor,
      setBrandColorPreset,
      setCustomBrandColor,
      brandPrimary: resolveBrandPrimary(brandColor),
    }),
    [theme, themePreference, setTheme, toggleTheme, brandColor, setBrandColorPreset, setCustomBrandColor],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Apply stored theme before first paint so TDesign tokens match on boot.
try {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  const bootTheme = resolveTheme(stored === "light" || stored === "dark" || stored === "system" ? stored : "light");
  if (stored === "light" || stored === "dark" || stored === "system") applyThemeToDocument(bootTheme);
  applyBrandColorToDocument(bootTheme, resolveBrandPrimary(readStoredBrandColor()));
} catch {
  /* ignore */
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
