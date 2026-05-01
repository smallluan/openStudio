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

const CHAT_STREAM_CHAN = "studio:chatStream";

contextBridge.exposeInMainWorld("studioBridge", {
  getUserConfig: () => ipcRenderer.invoke("studio:getUserConfig"),
  setUserConfig: (patch) => ipcRenderer.invoke("studio:setUserConfig", patch),
  getPaths: () => ipcRenderer.invoke("studio:getPaths"),
  probeGateway: () => ipcRenderer.invoke("studio:probeGateway"),
  bootstrapGateway: () => ipcRenderer.invoke("studio:bootstrapGateway"),
  startChatStream: (payload) => ipcRenderer.invoke("studio:startChatStream", payload),
  abortChatStream: (streamId) => ipcRenderer.invoke("studio:abortChatStream", streamId),
  onChatStream: (listener) => {
    const wrapped = (_e, data) => listener(data);
    ipcRenderer.on(CHAT_STREAM_CHAN, wrapped);
    return () => ipcRenderer.removeListener(CHAT_STREAM_CHAN, wrapped);
  },
  onBootstrapProgress: (listener) => {
    const wrapped = (_e, data) => listener(data);
    ipcRenderer.on("studio:bootstrapProgress", wrapped);
    return () => ipcRenderer.removeListener("studio:bootstrapProgress", wrapped);
  },
});
