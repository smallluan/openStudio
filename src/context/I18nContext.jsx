import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isLocaleId,
  messages,
} from "../i18n/messages.js";

/** @typedef {import("../i18n/messages.js").LocaleId} LocaleId */

/**
 * @param {unknown} root
 * @param {string[]} parts
 */
function getPath(root, parts) {
  let cur = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = /** @type {Record<string, unknown>} */ (cur)[p];
  }
  return cur;
}

/**
 * @param {string} template
 * @param {Record<string, string | number> | undefined} vars
 */
function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : "",
  );
}

/** @typedef {{
 *   locale: LocaleId;
 *   setLocale: (id: LocaleId) => void;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} I18nApi */

const I18nContext = /** @type {import("react").Context<I18nApi | null>} */ (
  createContext(null)
);

function readStoredLocale() {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocaleId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() =>
    typeof window !== "undefined" ? readStoredLocale() : DEFAULT_LOCALE,
  );

  const table = messages[locale];

  const setLocale = useCallback((id) => {
    setLocaleState(id);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key, vars) => {
      const fallback =
        vars && typeof vars.defaultValue === "string" ? vars.defaultValue : undefined;
      const v = getPath(table, key.split("."));
      if (typeof v === "string") return interpolate(v, vars);
      return fallback ?? key;
    },
    [table],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    document.title = t("app.documentTitle");
  }, [locale, t]);

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n() {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used within I18nProvider");
  return v;
}
