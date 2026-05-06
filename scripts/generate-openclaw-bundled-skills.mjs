/**
 * Reads bundled OpenClaw skills from node_modules/openclaw/skills (each SKILL.md) and writes
 * src/skills/openclawBundledSkillManifest.json for Open Studio UI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const skillsDir = path.join(root, "node_modules", "openclaw", "skills");
const outFile = path.join(root, "src", "skills", "openclawBundledSkillManifest.json");

if (!fs.existsSync(skillsDir)) {
  console.error("openclaw skills dir missing:", skillsDir);
  process.exit(1);
}

/** @param {string} fm */
function extractEmoji(fm) {
  const m = /"emoji"\s*:\s*"([^"]*)"/.exec(fm);
  return m ? m[1] : "📦";
}

/** @param {string} fm */
function extractName(fm) {
  const m = /^name:\s*(.+)$/m.exec(fm);
  return m ? m[1].trim() : "";
}

/** @param {string} fm */
function extractDescription(fm) {
  const q = /^description:\s*"((?:[^"\\]|\\.)*)"/m.exec(fm);
  if (q) return q[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
  const plain = /^description:\s*(.+)$/m.exec(fm);
  return plain ? plain[1].trim() : "";
}

const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
/** @type {Array<{ id: string; name: string; description: string; emoji: string; categoryId: string }>} */
const skills = [];

for (const ent of entries) {
  if (!ent.isDirectory()) continue;
  const id = ent.name;
  const fp = path.join(skillsDir, id, "SKILL.md");
  if (!fs.existsSync(fp)) continue;
  const raw = fs.readFileSync(fp, "utf8");
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) continue;
  const fm = block[1];
  const name = extractName(fm) || id;
  let description = extractDescription(fm);
  if (!description) description = "OpenClaw bundled skill.";
  const emoji = extractEmoji(fm);
  skills.push({
    id,
    name,
    description,
    emoji,
    categoryId: "cat-openclaw",
  });
}

skills.sort((a, b) => a.id.localeCompare(b.id));

const payload = {
  generatedFrom: "node_modules/openclaw/skills",
  generatedAt: new Date().toISOString(),
  count: skills.length,
  skills,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log("wrote", skills.length, "skills to", path.relative(root, outFile));
