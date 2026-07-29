/** @typedef {"light" | "dark"} ChatLabDocTheme */

/** Semantic tokens injected into sandboxed ```html``` iframes (mirrors theme.css). */
export const INLINE_HTML_THEME_TOKEN_NAMES = [
  "--os-text",
  "--os-text-muted",
  "--os-text-faint",
  "--os-bg-panel",
  "--os-bg-elevated",
  "--os-bg-subtle",
  "--os-bg-hover",
  "--os-border",
  "--os-border-strong",
  "--os-accent",
  "--os-accent-hover",
  "--os-accent-muted",
  "--os-accent-subtle",
  "--text",
  "--muted",
  "--border",
  "--accent",
];

/** @type {Record<ChatLabDocTheme, Record<string, string>>} */
const INLINE_HTML_THEME_FALLBACK = {
  light: {
    "--os-text": "#141820",
    "--os-text-muted": "rgba(20, 24, 32, 0.55)",
    "--os-text-faint": "rgba(20, 24, 32, 0.38)",
    "--os-bg-panel": "#ffffff",
    "--os-bg-elevated": "#ffffff",
    "--os-bg-subtle": "rgba(15, 23, 42, 0.045)",
    "--os-bg-hover": "rgba(15, 23, 42, 0.055)",
    "--os-border": "rgba(15, 23, 42, 0.09)",
    "--os-border-strong": "rgba(15, 23, 42, 0.14)",
    "--os-accent": "#0052d9",
    "--os-accent-hover": "#366ef4",
    "--os-accent-muted": "rgba(0, 82, 217, 0.14)",
    "--os-accent-subtle": "#f2f3ff",
    "--text": "#141820",
    "--muted": "rgba(20, 24, 32, 0.55)",
    "--border": "rgba(15, 23, 42, 0.09)",
    "--accent": "#0052d9",
  },
  dark: {
    "--os-text": "#e8eef4",
    "--os-text-muted": "rgba(232, 238, 244, 0.58)",
    "--os-text-faint": "rgba(232, 238, 244, 0.4)",
    "--os-bg-panel": "rgba(22, 28, 36, 0.82)",
    "--os-bg-elevated": "rgba(26, 32, 40, 0.76)",
    "--os-bg-subtle": "rgba(255, 255, 255, 0.045)",
    "--os-bg-hover": "rgba(255, 255, 255, 0.07)",
    "--os-border": "rgba(255, 255, 255, 0.08)",
    "--os-border-strong": "rgba(255, 255, 255, 0.14)",
    "--os-accent": "#366ef4",
    "--os-accent-hover": "#618dff",
    "--os-accent-muted": "rgba(54, 110, 244, 0.22)",
    "--os-accent-subtle": "#161e2e",
    "--text": "#e8eef4",
    "--muted": "rgba(232, 238, 244, 0.58)",
    "--border": "rgba(255, 255, 255, 0.08)",
    "--accent": "#366ef4",
  },
};

/**
 * Read resolved theme tokens from the host document (respects runtime brand overrides).
 * @returns {Record<string, string> | null}
 */
export function readInlineHtmlThemeTokensFromDocument() {
  if (typeof document === "undefined") return null;
  const style = getComputedStyle(document.documentElement);
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of INLINE_HTML_THEME_TOKEN_NAMES) {
    const value = style.getPropertyValue(name).trim();
    if (value) out[name] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * @param {ChatLabDocTheme} theme
 * @param {Record<string, string> | null | undefined} [fromDocument]
 * @returns {Record<string, string>}
 */
export function resolveInlineHtmlThemeTokens(theme, fromDocument) {
  const mode = theme === "dark" ? "dark" : "light";
  const fallback = INLINE_HTML_THEME_FALLBACK[mode];
  if (!fromDocument) return { ...fallback };
  return { ...fallback, ...fromDocument };
}

/**
 * Build a `<style>` tag that exposes Open Studio semantic colors inside the iframe.
 * @param {ChatLabDocTheme} theme
 * @param {Record<string, string> | null | undefined} [fromDocument]
 * @returns {string}
 */
export function buildInlineHtmlThemeStyleTag(theme, fromDocument) {
  const mode = theme === "dark" ? "dark" : "light";
  const tokens = resolveInlineHtmlThemeTokens(theme, fromDocument);
  const vars = INLINE_HTML_THEME_TOKEN_NAMES.map((name) => `${name}:${tokens[name] ?? ""}`)
    .join(";");
  return `<style>:root{${vars};color-scheme:${mode}}html,body{margin:0!important;padding:0!important;box-sizing:border-box;width:100%;max-width:100%;background:transparent!important;color:var(--os-text)}*,*:before,*:after{box-sizing:inherit}</style>`;
}
