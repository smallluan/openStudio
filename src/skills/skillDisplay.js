/**
 * @param {string} rawPath
 * @returns {string}
 */
export function pathBasename(rawPath) {
  const raw = String(rawPath ?? "").trim();
  if (!raw) return "";
  const norm = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = norm.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

/**
 * Display name for a user skill row: explicit skill name, then folder name.
 * @param {{ title?: string; localPath?: string; id?: string }} skill
 */
export function userSkillDisplayTitle(skill) {
  const title = String(skill?.title ?? "").trim();
  if (title) return title;
  const fromPath = pathBasename(skill?.localPath);
  if (fromPath) return fromPath;
  return String(skill?.id ?? "").trim() || "skill";
}

/**
 * Try to pull a filesystem path from assistant text (skill-creator output).
 * @param {string} text
 * @returns {string | undefined}
 */
export function extractSkillPathFromText(text) {
  const body = String(text ?? "");
  const win = body.match(/[A-Za-z]:\\[^\s"'<>|]+/);
  if (win) return win[0].replace(/[.,;:!?)]+$/g, "").trim();
  const unix = body.match(/(?:^|\s)(\/[^\s"'<>|]+)/m);
  if (unix) return unix[1].replace(/[.,;:!?)]+$/g, "").trim();
  return undefined;
}
