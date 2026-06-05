/**
 * Minimal ZIP writer (STORE / method 0 only) for memory-fs.
 * No external tools or npm packages required.
 */
import fs from "node:fs";
import path from "node:path";
import { crc32 } from "node:zlib";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/**
 * @param {string} rootDir
 * @param {string} outputZip
 * @param {{ shouldInclude?: (relPosix: string, absPath: string) => boolean }} [opts]
 */
export async function createStoreZipFromDirectory(rootDir, outputZip, opts = {}) {
  const shouldInclude =
    opts.shouldInclude ??
    (() => true);

  /** @type {Array<{ name: string; data: Buffer; crc: number; localOffset: number }>} */
  const entries = [];

  function walk(currentDir) {
    let list;
    try {
      list = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of list) {
      const abs = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(rootDir, abs).split(path.sep).join("/");
      if (!shouldInclude(rel, abs)) continue;
      const data = fs.readFileSync(abs);
      entries.push({
        name: rel,
        data,
        crc: crc32(data) >>> 0,
        localOffset: 0,
      });
    }
  }

  walk(rootDir);
  entries.sort((a, b) => a.name.localeCompare(b.name));

  /** @type {Buffer[]} */
  const parts = [];
  let offset = 0;

  for (const entry of entries) {
    entry.localOffset = offset;
    const nameBuf = Buffer.from(entry.name, "utf8");
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    parts.push(local, entry.data);
    offset += local.length + entry.data.length;
  }

  const centralStart = offset;
  /** @type {Buffer[]} */
  const centralParts = [];

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(entry.localOffset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);
  }

  const centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(outputZip), { recursive: true });
  const out = fs.createWriteStream(outputZip);
  for (const part of parts) out.write(part);
  for (const part of centralParts) out.write(part);
  out.write(eocd);
  await new Promise((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
    out.end();
  });

  return { files: entries.length, bytes: offset + centralSize + eocd.length };
}
