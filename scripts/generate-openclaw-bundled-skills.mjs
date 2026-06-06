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
  const plain = /^description:\s*(.+)$/m;
  const plainMatch = plain.exec(fm);
  return plainMatch ? plainMatch[1].trim() : "";
}

/** @param {string} block */
function quotedList(block) {
  if (!block) return [];
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** @param {string} fm */
function extractOpenclawMeta(fm) {
  /** @type {{ os: string[]; requiresBins: string[]; requiresEnv: string[] }} */
  const out = { os: [], requiresBins: [], requiresEnv: [] };
  if (!/"openclaw"/.test(fm)) return out;
  const osMatch = /"os"\s*:\s*\[([\s\S]*?)\]/m.exec(fm);
  if (osMatch) out.os = quotedList(osMatch[1]);
  const binsMatch = /"bins"\s*:\s*\[([\s\S]*?)\]/m.exec(fm);
  if (binsMatch) out.requiresBins = quotedList(binsMatch[1]);
  const envMatch = /"env"\s*:\s*\[([\s\S]*?)\]/m.exec(fm);
  if (envMatch) out.requiresEnv = quotedList(envMatch[1]);
  return out;
}

const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
/** @type {Array<{ id: string; name: string; description: string; emoji: string; categoryId: string; os: string[]; requiresBins: string[]; requiresEnv: string[] }>} */
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
  const meta = extractOpenclawMeta(fm);
  skills.push({
    id,
    name,
    description,
    emoji,
    categoryId: "cat-openclaw",
    os: meta.os,
    requiresBins: meta.requiresBins,
    requiresEnv: meta.requiresEnv,
  });
}

skills.sort((a, b) => a.id.localeCompare(b.id));

/** @returns {string} */
function readOpenClawPackageVersion() {
  try {
    const pkgPath = path.join(root, "node_modules", "openclaw", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

const payload = {
  generatedFrom: "node_modules/openclaw/skills",
  openclawVersion: readOpenClawPackageVersion(),
  count: skills.length,
  skills,
};

const nextBody = `${JSON.stringify(payload, null, 2)}\n`;
fs.mkdirSync(path.dirname(outFile), { recursive: true });
let prevBody = "";
try {
  prevBody = fs.readFileSync(outFile, "utf8");
} catch {
  /* first run */
}
if (prevBody === nextBody) {
  console.log("[generate-openclaw-bundled-skills] unchanged (%d skills)", skills.length);
} else {
  fs.writeFileSync(outFile, nextBody, "utf8");
  console.log("[generate-openclaw-bundled-skills] wrote %d skills to %s", skills.length, path.relative(root, outFile));
}
