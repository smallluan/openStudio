import { OPENCLAW_BUNDLED_SKILLS } from "./skillRegistry.js";

/** Built-in categories (labels via i18n: skillsPage.categoryLabels.*). */
export const BUILTIN_CATEGORY_IDS = {
  GENERAL: "cat-general",
  DEV: "cat-dev",
  OFFICE: "cat-office",
  DATA: "cat-data",
  /** All skills shipped under node_modules/openclaw/skills (see openclawBundledSkillManifest.json). */
  OPENCLAW_BUNDLED: "cat-openclaw",
};

/**
 * OpenClaw npm bundle definitions (authoritative list from SKILL.md frontmatter at generate time).
 * @type {Array<{ id: string; categoryId: string; icon: string }>}
 */
export const BUILTIN_SKILL_DEFS = OPENCLAW_BUNDLED_SKILLS.map((s) => ({
  id: s.id,
  categoryId: s.categoryId,
  icon: s.emoji,
}));
