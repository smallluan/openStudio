"use strict";

const fs = require("fs");
const path = require("path");
const { NtExecutable, NtExecutableResource, Data, Resource } = require("resedit");

/**
 * Embed a .ico into a Windows PE executable.
 * @param {string} exePath
 * @param {string} icoPath
 * @returns {boolean}
 */
function embedWinExeIcon(exePath, icoPath) {
  if (!fs.existsSync(exePath)) {
    console.warn(`[embed-win-exe-icon] exe not found: ${exePath}`);
    return false;
  }
  if (!fs.existsSync(icoPath)) {
    console.warn(`[embed-win-exe-icon] ico not found: ${icoPath}`);
    return false;
  }

  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);
  const iconFile = Data.IconFile.from(fs.readFileSync(icoPath));
  const icons = iconFile.icons.map((item) => item.data);
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const targets = groups.length > 0 ? groups : [{ id: 1, lang: 1033 }];
  const seen = new Set();

  for (const group of targets) {
    const key = `${group.id}:${group.lang}`;
    if (seen.has(key)) continue;
    seen.add(key);
    Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, icons);
  }
  if (!seen.has("1:1033")) {
    Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`[embed-win-exe-icon] embedded icon -> ${path.basename(exePath)} (${seen.size} group(s))`);
  return true;
}

module.exports = { embedWinExeIcon };

if (require.main === module) {
  const exe = process.argv[2];
  const ico = process.argv[3];
  if (!exe || !ico) {
    console.error("Usage: node embed-win-exe-icon.cjs <exe> <ico>");
    process.exit(1);
  }
  if (!embedWinExeIcon(exe, ico)) process.exit(1);
}
