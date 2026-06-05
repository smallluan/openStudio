/**
 * register.mjs - 入口注册文件
 * 
 * 用法: node --import ./src/register.mjs app.mjs
 * 
 * 环境变量:
 *   MEMORY_FS_ZIP      - zip 文件路径 (必须)
 *   MEMORY_FS_MOUNT    - 挂载路径，即原始 node_modules 目录 (必须)
 *   MEMORY_FS_UNPACKED - unpacked 目录路径 (.node 文件) (可选)
 * 
 * 幂等性:
 *   通过全局标记 globalThis.__MEMORY_FS_REGISTERED__ 防止重复注册。
 *   在 utilityProcess 中，--import (execArgv) 和 bootstrap 手动 import 可能都会触发本文件，
 *   幂等防护确保 ESM loader + CJS hooks 只注册一次。
 */

if (!globalThis.__MEMORY_FS_REGISTERED__) {
  // 立即标记，防止理论上的并发重入（--import 和 bootstrap 手动 import 同时触发）
  globalThis.__MEMORY_FS_REGISTERED__ = true;

  const { register } = await import("node:module");
  const path = (await import("node:path")).default;

  const zipPath = process.env.MEMORY_FS_ZIP;
  const mountPath = process.env.MEMORY_FS_MOUNT;
  const unpackedPath = process.env.MEMORY_FS_UNPACKED || "";

  if (!zipPath || !mountPath) {
    console.error(
      "[memory-fs] Missing required env vars: MEMORY_FS_ZIP, MEMORY_FS_MOUNT"
    );
    console.error(
      "  Example: MEMORY_FS_ZIP=./out/node_modules.zip MEMORY_FS_MOUNT=/path/to/node_modules node --import ./src/register.mjs app.mjs"
    );
    process.exit(1);
  }

  // 注册 ESM loader hooks (运行在独立线程)
  register("./loader.mjs", {
    parentURL: import.meta.url,
    data: {
      zipPath: path.resolve(zipPath),
      mountPath: path.resolve(mountPath),
      unpackedPath: unpackedPath ? path.resolve(unpackedPath) : "",
    },
  });

  // 同时在主线程初始化 archive，用于 CJS hook
  const archive = await import("./archive.mjs");
  await archive.init(
    path.resolve(zipPath),
    path.resolve(mountPath),
    unpackedPath ? path.resolve(unpackedPath) : ""
  );

  // Hook CJS fs 方法（主线程）
  await import("./cjs-hook.mjs");

  console.error("[memory-fs] Registered ESM loader + CJS hooks");
} else {
  console.error("[memory-fs] Already registered, skipping duplicate init");
}
