"use strict";

const fs = require("fs");
const path = require("path");

/**
 * 常见 Git 安装路径候选（Windows）
 * @param {string} programFiles
 * @param {string} programFilesX86
 * @returns {string[]}
 */
function getGitInstallCandidates(programFiles, programFilesX86) {
  return [
    path.join(programFiles, "Git", "usr", "bin"),
    path.join(programFilesX86, "Git", "usr", "bin"),
    // 便携版 Git
    path.join(programFiles, "PortableGit", "usr", "bin"),
    path.join(programFilesX86, "PortableGit", "usr", "bin"),
    // scoop 安装
    path.join(process.env.USERPROFILE || "", "scoop", "apps", "git", "current", "usr", "bin"),
    // chocolatey 安装
    path.join(process.env.ChocolateyInstall || path.join(programFiles, "Chocolatey"), "lib", "git", "tools", "usr", "bin"),
  ];
}

/**
 * 检测 Windows 系统上 Git 的 Unix 工具路径并注入到 PATH
 * @param {{ log?: { info: (msg: string, ...args: any[]) => void; warn: (msg: string, ...args: any[]) => void } }} opts
 * @returns {{ ok: boolean; injectedPath?: string; reason?: string }}
 */
function injectGitUnixToolsPath(opts = {}) {
  const log = opts.log;
  
  // 仅 Windows 需要处理
  if (process.platform !== "win32") {
    return { ok: false, reason: "not_windows" };
  }

  const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const candidates = getGitInstallCandidates(programFiles, programFilesX86);
  
  for (const candidate of candidates) {
    if (!candidate) continue;
    
    // 检查路径是否存在
    let exists = false;
    try {
      exists = fs.existsSync(candidate);
    } catch {
      continue;
    }
    
    if (!exists) continue;
    
    // 验证关键工具存在
    const grepPath = path.join(candidate, "grep.exe");
    let hasGrep = false;
    try {
      hasGrep = fs.existsSync(grepPath);
    } catch {
      continue;
    }
    
    if (!hasGrep) continue;
    
    // 检查是否已在 PATH 中
    const currentPath = process.env.PATH || "";
    const pathSeparator = ";";
    const pathEntries = currentPath.split(pathSeparator).map(p => p.trim().toLowerCase()).filter(Boolean);
    const candidateLower = candidate.toLowerCase();
    
    if (pathEntries.includes(candidateLower)) {
      return { ok: true, injectedPath: candidate, reason: "already_in_path" };
    }
    
    // 注入到 PATH 开头，确保优先级高于系统自带的 sort 等
    const newPath = candidate + pathSeparator + currentPath;
    process.env.PATH = newPath;
    
    if (log) {
      log.info("[git-unix-tools] Injected Git Unix tools to PATH", { path: candidate });
    }
    
    return { ok: true, injectedPath: candidate };
  }
  
  if (log) {
    log.warn("[git-unix-tools] Git Unix tools not found in common locations");
  }
  
  return { ok: false, reason: "git_not_found" };
}

module.exports = {
  injectGitUnixToolsPath,
};
