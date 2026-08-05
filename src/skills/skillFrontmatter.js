/**
 * @param {string} raw
 * @returns {string}
 */
function parseFrontmatterValue(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed.trim() : "";
    } catch {
      return value.slice(1, -1).trim();
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'").trim();
  }
  return value.trim();
}

/**
 * Read the standard name and description fields from SKILL.md frontmatter.
 *
 * @param {unknown} content
 * @returns {{ name: string; description: string; icon: string }}
 */
export function parseSkillFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(content ?? ""));
  if (!match) return { name: "", description: "", icon: "" };

  let name = "";
  let description = "";
  let icon = "";
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const field = /^(name|description|icon)\s*:\s*(.*)$/i.exec(line);
    if (!field) continue;
    const value = parseFrontmatterValue(field[2]);
    if (field[1].toLowerCase() === "name") name = value;
    else if (field[1].toLowerCase() === "description") description = value;
    else icon = value;
  }
  return { name, description, icon };
}
