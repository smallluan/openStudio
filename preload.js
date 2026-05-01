const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  name: "Open Studio",
});

contextBridge.exposeInMainWorld("openclawBridge", {
  getRuntime: () => ipcRenderer.invoke("openclaw:getRuntime"),
});
