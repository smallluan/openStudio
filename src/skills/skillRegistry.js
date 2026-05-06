import openclawManifest from "./openclawBundledSkillManifest.json";
import { loadSkillLibrary } from "./skillsLocalStore.js";

/** @typedef {{ generatedFrom: string; generatedAt: string; count: number; skills: Array<{ id: string; name: string; description: string; emoji: string; categoryId: string }> }} OpenclawBundledManifest */

export const OPENCLAW_BUNDLED_SKILL_MANIFEST = openclawManifest;

export const OPENCLAW_BUNDLED_SKILLS = openclawManifest.skills;

/**
 * Display title from skill slug / frontmatter name (e.g. skill-creator → Skill Creator).
 * @param {string} slug
 */
export function formatSkillTitle(slug) {
  return String(slug || "")
    .split(/[-_]/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * @typedef {{
 *   kind: "openclaw";
 *   id: string;
 *   slug: string;
 *   label: string;
 *   emoji: string;
 *   description: string;
 *   searchText: string;
 * }} OpenClawPickSkill
 */

/**
 * @typedef {{
 *   kind: "user";
 *   id: string;
 *   userSkillId: string;
 *   label: string;
 *   emoji: string;
 *   description: string;
 *   localPath?: string;
 *   searchText: string;
 * }} UserPickSkill
 */

/** @typedef {OpenClawPickSkill | UserPickSkill} SkillPickRow */

/** Build merged list for chat pickers (OpenClaw bundled + saved user skills). */
export function listSkillsForPicker() {
  const lib = loadSkillLibrary();
  /** @type {SkillPickRow[]} */
  const openclaw = OPENCLAW_BUNDLED_SKILLS.map((s) => {
    const label = formatSkillTitle(s.name);
    const blob = `${s.id} ${s.name} ${label} ${s.description}`.toLowerCase();
    return {
      kind: /** @type {const} */ ("openclaw"),
      id: `oc:${s.id}`,
      slug: s.id,
      label,
      emoji: s.emoji,
      description: s.description,
      searchText: blob,
    };
  });
  /** @type {SkillPickRow[]} */
  const user = lib.userSkills.map((s) => {
    const blob = `${s.title} ${s.description ?? ""} ${s.localPath ?? ""}`.toLowerCase();
    return {
      kind: /** @type {const} */ ("user"),
      id: `us:${s.id}`,
      userSkillId: s.id,
      label: s.title,
      emoji: s.fromNl ? "✨" : "📁",
      description: s.description ?? "",
      localPath: s.localPath,
      searchText: blob,
    };
  });
  return [...openclaw, ...user];
}

/** @param {SkillPickRow[]} list @param {string} query */
export function filterSkillPickList(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) => s.searchText.includes(q));
}

/**
 * Payload forwarded to gateway stream (main process) to prefix the user message.
 * @typedef {{
 *   kind: "openclaw";
 *   slug: string;
 *   label: string;
 * } | {
 *   kind: "user";
 *   label: string;
 *   description?: string;
 *   localPath?: string;
 * }} ComposerSkillPayload
 */

/**
 * @param {SkillPickRow | null} row
 * @returns {ComposerSkillPayload | null}
 */
export function skillPickRowToPayload(row) {
  if (!row) return null;
  if (row.kind === "openclaw") {
    return { kind: "openclaw", slug: row.slug, label: row.label };
  }
  return {
    kind: "user",
    label: row.label,
    description: row.description || undefined,
    localPath: row.localPath || undefined,
  };
}

/**
 * Strips a small skill snapshot for message persistence + UI tags.
 * @param {SkillPickRow | null | undefined} row
 * @returns {{ kind: 'openclaw'; slug: string; label: string; emoji: string } | { kind: 'user'; userSkillId: string; label: string; emoji: string } | undefined}
 */
export function skillMetaFromPickRow(row) {
  if (!row) return undefined;
  if (row.kind === "openclaw") {
    return { kind: "openclaw", slug: row.slug, label: row.label, emoji: row.emoji };
  }
  return { kind: "user", userSkillId: row.userSkillId, label: row.label, emoji: row.emoji };
}

/**
 * @param {{ kind?: string; slug?: string; userSkillId?: string; label?: string; emoji?: string } | null | undefined} meta
 * @param {SkillPickRow[]} list
 * @returns {SkillPickRow | null}
 */
export function pickRowFromSkillMeta(meta, list) {
  if (!meta || (meta.kind !== "openclaw" && meta.kind !== "user")) return null;
  if (meta.kind === "openclaw") {
    const slug = typeof meta.slug === "string" ? meta.slug.trim() : "";
    if (!slug) return null;
    const hit = list.find((r) => r.kind === "openclaw" && r.slug === slug);
    if (hit) return hit;
    return {
      kind: /** @type {const} */ ("openclaw"),
      id: `oc:${slug}`,
      slug,
      label: meta.label || formatSkillTitle(slug),
      emoji: meta.emoji || "🧩",
      description: "",
      searchText: "",
    };
  }
  const uid = typeof meta.userSkillId === "string" ? meta.userSkillId.trim() : "";
  if (!uid) return null;
  const hit = list.find((r) => r.kind === "user" && r.userSkillId === uid);
  if (hit) return hit;
  return {
    kind: /** @type {const} */ ("user"),
    id: `us:${uid}`,
    userSkillId: uid,
    label: meta.label || uid,
    emoji: meta.emoji || "📁",
    description: "",
    searchText: "",
  };
}
