const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  name: "Open Studio",
});

contextBridge.exposeInMainWorld("electronShell", {
  platform: process.platform,
  minimize: () => ipcRenderer.invoke("shell:windowMinimize"),
  toggleMaximize: () => ipcRenderer.invoke("shell:windowToggleMaximize"),
  close: () => ipcRenderer.invoke("shell:windowClose"),
  isMaximized: () => ipcRenderer.invoke("shell:isWindowMaximized"),
});

contextBridge.exposeInMainWorld("openclawBridge", {
  getRuntime: () => ipcRenderer.invoke("openclaw:getRuntime"),
});

contextBridge.exposeInMainWorld("studioBridge", {
  getUserConfig: () => ipcRenderer.invoke("studio:getUserConfig"),
  setUserConfig: (patch) => ipcRenderer.invoke("studio:setUserConfig", patch),
  getPaths: () => ipcRenderer.invoke("studio:getPaths"),
});
