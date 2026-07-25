/**
 * @param {import("../skills/skillRegistry.js").ComposerSkillPayload | null} s
 */
export function formatComposerSkillDirective(s) {
  if (!s || typeof s !== "object") return "";
  const kind = s.kind;
  if (kind === "openclaw") {
    const slug = String(s.slug ?? "").trim();
    const label = String(s.label ?? "").trim();
    if (!slug) return "";
    const labelBit = label ? ` (${label})` : "";
    return `[OpenClaw skill: ${slug}]${labelBit} Please follow this bundled SKILL when it applies to the user's request.`;
  }
  if (kind === "user") {
    const label = String(s.label ?? "").trim();
    const desc = String(s.description ?? "").trim();
    const localPath = String(s.localPath ?? "").trim();
    if (!label) return "";
    const parts = [label];
    if (desc) parts.push(desc);
    if (localPath) parts.push(`Path: ${localPath}`);
    return `[User-registered skill] ${parts.join(" — ")}`;
  }
  return "";
}
