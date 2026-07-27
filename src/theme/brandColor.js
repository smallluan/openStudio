/** @typedef {{ type: "preset"; id: string } | { type: "custom"; color: string }} BrandColorSelection */

export const BRAND_COLOR_STORAGE_KEY = "openstudio_brand_color";

/** TDesign built-in primary colors (brand-7 in light mode). */
export const BUILTIN_BRAND_PRESETS = [
  { id: "blue", color: "#0052D9" },
  { id: "purple", color: "#8E56DD" },
  { id: "cyan", color: "#0594FA" },
  { id: "green", color: "#00A870" },
  { id: "orange", color: "#E37318" },
  { id: "red", color: "#D54941" },
  { id: "pink", color: "#ED49B4" },
  { id: "yellow", color: "#EBB105" },
];

const DEFAULT_PRESET_ID = "blue";

/**
 * @param {string} hex
 * @returns {{ r: number; g: number; b: number } | null}
 */
function parseHex(hex) {
  const normalized = String(hex || "")
    .trim()
    .replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

/**
 * @param {{ r: number; g: number; b: number }} c
 */
function toHex({ r, g, b }) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * @param {{ r: number; g: number; b: number }} a
 * @param {{ r: number; g: number; b: number }} b
 * @param {number} weight 0 = a, 1 = b
 */
function mixRgb(a, b, weight) {
  const t = Math.max(0, Math.min(1, weight));
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

/**
 * @param {string} primary
 * @returns {string[]}
 */
export function generateLightBrandScale(primary) {
  const base = parseHex(primary);
  if (!base) return generateLightBrandScale(BUILTIN_BRAND_PRESETS[0].color);

  /** @type {string[]} */
  const steps = [];
  for (let i = 1; i <= 10; i += 1) {
    if (i < 7) {
      const weight = ((7 - i) / 6) * 0.94;
      steps.push(toHex(mixRgb(base, WHITE, weight)));
    } else if (i === 7) {
      steps.push(toHex(base).toUpperCase());
    } else {
      const weight = ((i - 7) / 3) * 0.78;
      steps.push(toHex(mixRgb(base, BLACK, weight)));
    }
  }
  return steps;
}

/**
 * @param {string} primary
 * @returns {string[]}
 */
export function generateDarkBrandScale(primary) {
  const base = parseHex(primary);
  if (!base) return generateDarkBrandScale(BUILTIN_BRAND_PRESETS[0].color);

  /** @type {string[]} */
  const steps = [];
  for (let i = 1; i <= 10; i += 1) {
    const t = (i - 1) / 9;
    if (t <= 0.45) {
      steps.push(toHex(mixRgb(base, BLACK, 0.72 - t * 0.9)));
    } else if (t <= 0.72) {
      steps.push(toHex(mixRgb(base, BLACK, 0.18 - (t - 0.45) * 0.35)));
    } else {
      steps.push(toHex(mixRgb(base, WHITE, (t - 0.72) * 1.35)));
    }
  }
  return steps;
}

/**
 * @param {string} primary
 */
export function resolveBrandScales(primary) {
  const color = normalizeHex(primary) ?? BUILTIN_BRAND_PRESETS[0].color;
  return {
    light: generateLightBrandScale(color),
    dark: generateDarkBrandScale(color),
    primary: color,
  };
}

/**
 * @param {string | undefined | null} hex
 */
export function normalizeHex(hex) {
  const rgb = parseHex(hex ?? "");
  return rgb ? toHex(rgb).toUpperCase() : null;
}

/**
 * @param {string} hex
 * @param {number} alpha
 */
function hexToRgba(hex, alpha) {
  const rgb = parseHex(hex);
  if (!rgb) return `rgba(0, 82, 217, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * @param {"light" | "dark"} theme
 * @param {string} primary
 */
export function applyBrandColorToDocument(theme, primary) {
  const { light, dark } = resolveBrandScales(primary);
  const scale = theme === "dark" ? dark : light;
  const root = document.documentElement;

  scale.forEach((color, index) => {
    root.style.setProperty(`--td-brand-color-${index + 1}`, color);
    root.style.setProperty(`--os-brand-${index + 1}`, color);
  });

  const accent = theme === "dark" ? scale[7] : scale[6];
  const accentHover = theme === "dark" ? scale[6] : scale[5];
  const accentSubtle = theme === "dark"
    ? `color-mix(in srgb, ${scale[8]} 42%, var(--os-bg-panel))`
    : scale[0];

  root.style.setProperty("--os-accent", accent);
  root.style.setProperty("--os-accent-hover", accentHover);
  root.style.setProperty("--os-accent-muted", hexToRgba(accent, theme === "dark" ? 0.22 : 0.14));
  root.style.setProperty("--os-accent-subtle", accentSubtle);
  root.style.setProperty("--os-focus-ring", hexToRgba(accent, theme === "dark" ? 0.42 : 0.35));
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-hover", accentHover);
}

/**
 * @returns {BrandColorSelection}
 */
export function readStoredBrandColor() {
  try {
    const raw = window.localStorage.getItem(BRAND_COLOR_STORAGE_KEY);
    if (!raw) return { type: "preset", id: DEFAULT_PRESET_ID };
    const parsed = JSON.parse(raw);
    if (parsed?.type === "preset" && BUILTIN_BRAND_PRESETS.some((p) => p.id === parsed.id)) {
      return { type: "preset", id: parsed.id };
    }
    if (parsed?.type === "custom") {
      const color = normalizeHex(parsed.color);
      if (color) return { type: "custom", color };
    }
  } catch {
    /* ignore */
  }
  return { type: "preset", id: DEFAULT_PRESET_ID };
}

/**
 * @param {BrandColorSelection} selection
 */
export function writeStoredBrandColor(selection) {
  try {
    window.localStorage.setItem(BRAND_COLOR_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    /* ignore */
  }
}

/**
 * @param {BrandColorSelection} selection
 */
export function resolveBrandPrimary(selection) {
  if (selection.type === "custom") {
    return normalizeHex(selection.color) ?? BUILTIN_BRAND_PRESETS[0].color;
  }
  const preset = BUILTIN_BRAND_PRESETS.find((p) => p.id === selection.id);
  return preset?.color ?? BUILTIN_BRAND_PRESETS[0].color;
}

/**
 * @param {BrandColorSelection} a
 * @param {BrandColorSelection} b
 */
export function isSameBrandColor(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === "preset") return a.id === b.id;
  return normalizeHex(a.color) === normalizeHex(b.color);
}
