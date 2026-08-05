const STORAGE_KEY = "openstudio_skill_library_v1";

/**
 * @typedef {{ id: string; label: string }} UserCategoryRow
 * @typedef {{ id: string; title: string; description: string; icon?: string; categoryId: string; localPath?: string; browserDomPolicy?: "auto" | "selector-only" | "full"; fromNl?: boolean; createdAt: number }} UserSkillRow
 * @typedef {{ userCategories: UserCategoryRow[]; userSkills: UserSkillRow[] }} SkillLibrarySnapshot
 */

/** @returns {SkillLibrarySnapshot} */
export function loadSkillLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { userCategories: [], userSkills: [] };
    const data = JSON.parse(raw);
    return {
      userCategories: Array.isArray(data.userCategories) ? data.userCategories : [],
      userSkills: Array.isArray(data.userSkills) ? data.userSkills : [],
    };
  } catch {
    return { userCategories: [], userSkills: [] };
  }
}

/** @param {SkillLibrarySnapshot} lib */
export function saveSkillLibrary(lib) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        userCategories: lib.userCategories,
        userSkills: lib.userSkills,
      }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}
