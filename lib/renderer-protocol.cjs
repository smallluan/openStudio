/**
 * Serve packaged renderer from dist/ via a privileged custom scheme.
 * file:// loads often break CSS backdrop-filter / GPU compositing on Windows Electron.
 */
const fs = require("fs");
const path = require("path");
const { protocol } = require("electron");

const SCHEME = "app";
const HOST = "open-studio";

const MIME_BY_EXT = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
]);

function contentTypeFor(filePath) {
  return MIME_BY_EXT.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

/** Must run before app.whenReady(). */
function registerRendererSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/**
 * @param {string} appRootDir - directory containing dist/ (asar root in production)
 */
function registerRendererProtocol(appRootDir) {
  const distRoot = path.join(appRootDir, "dist");
  if (!fs.existsSync(distRoot)) {
    throw new Error(`[renderer-protocol] dist not found: ${distRoot}`);
  }

  const distRootNorm = path.normalize(distRoot);

  protocol.handle(SCHEME, async (request) => {
    let pathname = "";
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const rel = pathname.replace(/^\/+/, "") || "index.html";
    const filePath = path.normalize(path.join(distRootNorm, rel));
    if (filePath !== distRootNorm && !filePath.startsWith(`${distRootNorm}${path.sep}`)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!fs.existsSync(filePath)) {
      return new Response("Not Found", { status: 404 });
    }

    // 直接读取文件内容并构造 Response，避免 net.fetch() 代理 file:// 时
    // 丢失 Chromium GPU 合成器所需的内部元数据（解决 backdrop-filter 失效问题）
    const content = await fs.promises.readFile(filePath);
    const headers = new Headers();
    headers.set("content-type", contentTypeFor(filePath));
    headers.set("cache-control", "no-cache");
    return new Response(content, {
      status: 200,
      statusText: "OK",
      headers,
    });
  });
}

function getProductionRendererUrl() {
  return `${SCHEME}://${HOST}/index.html`;
}

module.exports = {
  registerRendererSchemePrivileges,
  registerRendererProtocol,
  getProductionRendererUrl,
};
