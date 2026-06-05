"use strict";

const { copyFileSync, existsSync, renameSync, rmSync } = require("fs");

function normWin(p) {
  if (process.platform !== "win32") return p;
  if (p.startsWith("\\\\?\\")) return p;
  return `\\\\?\\${p.replace(/\//g, "\\")}`;
}

/** @param {number} ms */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rmWithRetry(targetPath, { recursive = false, retries = 12, delayMs = 200 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      rmSync(normWin(targetPath), {
        recursive,
        force: true,
        maxRetries: 3,
        retryDelay: delayMs,
      });
      return;
    } catch (err) {
      lastErr = err;
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return;
      if (err && err.code !== "EBUSY" && err.code !== "EPERM") throw err;
      if (attempt < retries - 1) sleepSync(delayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

function replaceFileWithRetry(targetPath, tempPath) {
  const backupPath = `${targetPath}.bak`;
  if (existsSync(normWin(backupPath))) rmWithRetry(backupPath);

  let movedAside = false;
  if (existsSync(normWin(targetPath))) {
    try {
      renameSync(normWin(targetPath), normWin(backupPath));
      movedAside = true;
    } catch {
      rmWithRetry(targetPath);
    }
  }

  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      renameSync(normWin(tempPath), normWin(targetPath));
      if (movedAside) rmWithRetry(backupPath);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 7) sleepSync(150 * (attempt + 1));
    }
  }

  if (movedAside && existsSync(normWin(backupPath)) && !existsSync(normWin(targetPath))) {
    try {
      renameSync(normWin(backupPath), normWin(targetPath));
    } catch {
      /* ignore restore failure */
    }
  }
  throw lastErr;
}

module.exports = {
  normWin,
  sleepSync,
  rmWithRetry,
  replaceFileWithRetry,
};
