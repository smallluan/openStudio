const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const { createConfigStore } = require("./lib/config-store.cjs");

const isDev = process.env.NODE_ENV === "development";
const requireFromApp = createRequire(__dirname);

/** @type {ReturnType<typeof createConfigStore> | null} */
let userConfigStore = null;

function getOpenClawPackageMeta() {
  try {
    const pkgPath = requireFromApp.resolve("openclaw/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const root = path.dirname(pkgPath);
    const cliEntry = path.join(root, pkg.bin.openclaw.replace(/^\.\//, ""));
    return { version: pkg.version, root, cliEntry };
  } catch {
    return null;
  }
}

async function getOpenClawLibrarySurface() {
  try {
    const oc = await import("openclaw");
    const keys = Object.keys(oc).sort();
    return { exportCount: keys.length, exports: keys };
  } catch (err) {
    return { error: String(err?.message ?? err), exportCount: 0, exports: [] };
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  userConfigStore = createConfigStore(app.getPath("userData"));

  ipcMain.handle("openclaw:getRuntime", async () => {
    const meta = getOpenClawPackageMeta();
    const lib = await getOpenClawLibrarySurface();
    return { meta, lib, processVersions: process.versions };
  });

  ipcMain.handle("studio:getUserConfig", () => {
    return userConfigStore.getSanitized();
  });

  ipcMain.handle("studio:setUserConfig", (_event, patch) => {
    return userConfigStore.applyPatch(patch ?? {});
  });

  ipcMain.handle("studio:getPaths", () => ({
    userData: app.getPath("userData"),
  }));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
