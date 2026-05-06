/** Heuristic: first message on chat landing reads like “create a skill”. */
export function isSkillCreationNlIntent(text) {
  const s = String(text ?? "").trim();
  if (!s) return false;
  if (/创建(一个)?\s*技能/i.test(s)) return true;
  if (/新建\s*技能/i.test(s)) return true;
  if (/帮我\s*(写|做|创建)\s*技能/i.test(s)) return true;
  if (/写\s*个技能/i.test(s)) return true;
  if (/^\s*create\s+(a\s+)?skill\b/i.test(s)) return true;
  return false;
}
