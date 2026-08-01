import { useCallback, useEffect, useState } from "react";
import { loadSkillLibrary, saveSkillLibrary } from "./skillsLocalStore.js";

export function useSkillLibrary() {
  const [lib, setLib] = useState(loadSkillLibrary);

  useEffect(() => {
    const onExternal = () => setLib(loadSkillLibrary());
    window.addEventListener("openstudio-skill-library-changed", onExternal);
    return () => window.removeEventListener("openstudio-skill-library-changed", onExternal);
  }, []);

  useEffect(() => {
    saveSkillLibrary(lib);
  }, [lib]);

  const addUserSkill = useCallback((partial) => {
    const row = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `skill-${Date.now()}`,
      title: partial.title,
      description: partial.description ?? "",
      categoryId: partial.categoryId,
      localPath: partial.localPath,
      browserDomPolicy: partial.browserDomPolicy,
      fromNl: partial.fromNl ?? false,
      createdAt: Date.now(),
    };
    setLib((prev) => ({ ...prev, userSkills: [...prev.userSkills, row] }));
  }, []);

  const removeUserSkill = useCallback((id) => {
    setLib((prev) => ({
      ...prev,
      userSkills: prev.userSkills.filter((s) => s.id !== id),
    }));
  }, []);

  const addUserCategory = useCallback((label) => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `cat-${Date.now()}`;
    setLib((prev) => ({
      ...prev,
      userCategories: [...prev.userCategories, { id, label: label.trim() }],
    }));
    return id;
  }, []);

  const removeUserCategory = useCallback((id) => {
    setLib((prev) => ({
      ...prev,
      userCategories: prev.userCategories.filter((c) => c.id !== id),
      userSkills: prev.userSkills.map((s) => (s.categoryId === id ? { ...s, categoryId: "cat-general" } : s)),
    }));
  }, []);

  return { lib, setLib, addUserSkill, removeUserSkill, addUserCategory, removeUserCategory };
}
