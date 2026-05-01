import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";

/** @typedef {"zh-CN" | "zh-TW" | "en" | "ja"} LocaleId */

/** @type {LocaleId[]} */
export const LOCALE_IDS = ["zh-CN", "zh-TW", "en", "ja"];

/** @type {Record<LocaleId, typeof zhCN>} */
export const messages = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
  ja,
};

export const DEFAULT_LOCALE = /** @type {LocaleId} */ ("zh-CN");

export const LOCALE_STORAGE_KEY = "openstudio_locale";

/** @param {unknown} v @returns {v is LocaleId} */
export function isLocaleId(v) {
  return typeof v === "string" && LOCALE_IDS.includes(/** @type {LocaleId} */ (v));
}
