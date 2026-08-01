import openclawManifest from "./openclawBundledSkillManifest.json";
import { filterUsableBundledSkills } from "./skillAvailability.js";
import { userSkillDisplayTitle } from "./skillDisplay.js";
import { loadSkillLibrary } from "./skillsLocalStore.js";

/** @typedef {{ generatedFrom: string; openclawVersion: string; count: number; skills: Array<{ id: string; name: string; description: string; emoji: string; categoryId: string; browserDomPolicy?: string }> }} OpenclawBundledManifest */

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
 *   browserDomPolicy?: "auto" | "selector-only" | "full";
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
 *   browserDomPolicy?: "auto" | "selector-only" | "full";
 *   searchText: string;
 * }} UserPickSkill
 */

/** @typedef {OpenClawPickSkill | UserPickSkill} SkillPickRow */

/**
 * Build merged list for chat pickers (OpenClaw bundled + saved user skills).
 * @param {{ platform?: string; availableBins?: string[] } | null} [env] When set, omit bundled skills not usable on this machine.
 */
export function listSkillsForPicker(env) {
  const lib = loadSkillLibrary();
  const bundled = env ? filterUsableBundledSkills(OPENCLAW_BUNDLED_SKILLS, env) : OPENCLAW_BUNDLED_SKILLS;
  /** @type {SkillPickRow[]} */
  const openclaw = bundled.map((s) => {
    const label = formatSkillTitle(s.name);
    const blob = `${s.id} ${s.name} ${label} ${s.description}`.toLowerCase();
    return {
      kind: /** @type {const} */ ("openclaw"),
      id: `oc:${s.id}`,
      slug: s.id,
      label,
      emoji: s.emoji,
      description: s.description,
      browserDomPolicy: s.browserDomPolicy,
      searchText: blob,
    };
  });
  /** @type {SkillPickRow[]} */
  const user = lib.userSkills.map((s) => {
    const label = userSkillDisplayTitle(s);
    const blob = `${label} ${s.title} ${s.description ?? ""} ${s.localPath ?? ""}`.toLowerCase();
    return {
      kind: /** @type {const} */ ("user"),
      id: `us:${s.id}`,
      userSkillId: s.id,
      label,
      emoji: s.fromNl ? "✨" : "📁",
      description: s.description ?? "",
      localPath: s.localPath,
      browserDomPolicy: s.browserDomPolicy,
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
 *   browserDomPolicy?: "auto" | "selector-only" | "full";
 * } | {
 *   kind: "user";
 *   label: string;
 *   description?: string;
 *   localPath?: string;
 *   browserDomPolicy?: "auto" | "selector-only" | "full";
 * }} ComposerSkillPayload
 */

/**
 * @param {SkillPickRow | null} row
 * @returns {ComposerSkillPayload | null}
 */
export function skillPickRowToPayload(row) {
  if (!row) return null;
  if (row.kind === "openclaw") {
    return {
      kind: "openclaw",
      slug: row.slug,
      label: row.label,
      browserDomPolicy: browserDomPolicyFromPickRow(row),
    };
  }
  return {
    kind: "user",
    label: row.label,
    description: row.description || undefined,
    localPath: row.localPath || undefined,
    browserDomPolicy: browserDomPolicyFromPickRow(row),
  };
}

/**
 * Skills may opt into selector-only passive context without changing the normal
 * conversation default. The marker is intentionally plain text so it also works
 * for skills loaded from a local SKILL.md description.
 *
 * @param {SkillPickRow | null | undefined} row
 * @returns {"auto" | "selector-only" | "full" | undefined}
 */
export function browserDomPolicyFromPickRow(row) {
  const explicit = String(row?.browserDomPolicy ?? "").trim().toLowerCase();
  if (explicit === "selector-only" || explicit === "full" || explicit === "auto") return explicit;
  return browserDomPolicyFromSkillContent(row?.description);
}

/**
 * @param {unknown} content
 * @returns {"auto" | "selector-only" | "full" | undefined}
 */
export function browserDomPolicyFromSkillContent(content) {
  const match = /(?:\[openstudio:browser-dom=|browserDomPolicy\s*:\s*)(auto|selector-only|full)/i.exec(
    String(content ?? ""),
  );
  return match ? /** @type {any} */ (match[1].toLowerCase()) : undefined;
}

/**
 * Strips a small skill snapshot for message persistence + UI tags.
 * @param {SkillPickRow | null | undefined} row
 * @returns {{ kind: 'openclaw'; slug: string; label: string; emoji: string; browserDomPolicy?: string } | { kind: 'user'; userSkillId: string; label: string; emoji: string; browserDomPolicy?: string } | undefined}
 */
export function skillMetaFromPickRow(row) {
  if (!row) return undefined;
  if (row.kind === "openclaw") {
    return {
      kind: "openclaw",
      slug: row.slug,
      label: row.label,
      emoji: row.emoji,
      browserDomPolicy: browserDomPolicyFromPickRow(row),
    };
  }
  return {
    kind: "user",
    userSkillId: row.userSkillId,
    label: row.label,
    emoji: row.emoji,
    browserDomPolicy: browserDomPolicyFromPickRow(row),
  };
}

/**
 * @param {{ kind?: string; slug?: string; userSkillId?: string; label?: string; emoji?: string; browserDomPolicy?: string } | null | undefined} meta
 * @param {SkillPickRow[]} list
 * @returns {SkillPickRow | null}
 */
export function pickRowFromSkillMeta(meta, list) {
  if (!meta || (meta.kind !== "openclaw" && meta.kind !== "user")) return null;
  if (meta.kind === "openclaw") {
    const slug = typeof meta.slug === "string" ? meta.slug.trim() : "";
    if (!slug) return null;
    const hit = list.find((r) => r.kind === "openclaw" && r.slug === slug);
    if (hit) return hit.browserDomPolicy ? hit : { ...hit, browserDomPolicy: meta.browserDomPolicy };
    return {
      kind: /** @type {const} */ ("openclaw"),
      id: `oc:${slug}`,
      slug,
      label: meta.label || formatSkillTitle(slug),
      emoji: meta.emoji || "🧩",
      description: "",
      searchText: "",
      browserDomPolicy: meta.browserDomPolicy,
    };
  }
  const uid = typeof meta.userSkillId === "string" ? meta.userSkillId.trim() : "";
  if (!uid) return null;
  const hit = list.find((r) => r.kind === "user" && r.userSkillId === uid);
  if (hit) return hit.browserDomPolicy ? hit : { ...hit, browserDomPolicy: meta.browserDomPolicy };
  return {
    kind: /** @type {const} */ ("user"),
    id: `us:${uid}`,
    userSkillId: uid,
    label: meta.label || uid,
    emoji: meta.emoji || "📁",
    description: "",
    searchText: "",
    browserDomPolicy: meta.browserDomPolicy,
  };
}
