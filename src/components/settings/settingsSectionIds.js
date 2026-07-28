/** Shared settings section ids (rail radial + full settings modal). */
export const SETTINGS_SECTION_IDS = /** @type {const} */ ([
  "profile",
  "general",
  "accounts",
  "channels",
  "usage",
  "debug",
  "model",
]);

/** @typedef {(typeof SETTINGS_SECTION_IDS)[number]} SettingsSectionId */

/** @param {string} id */
export function isSettingsSectionId(id) {
  return /** @type {readonly string[]} */ (SETTINGS_SECTION_IDS).includes(id);
}
