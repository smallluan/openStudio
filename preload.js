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
const WECHAT_STATUS_CHAN = "studio:wechatStatus";

contextBridge.exposeInMainWorld("studioBridge", {
  getUserConfig: () => ipcRenderer.invoke("studio:getUserConfig"),
  setUserConfig: (patch) => ipcRenderer.invoke("studio:setUserConfig", patch),
  getPaths: () => ipcRenderer.invoke("studio:getPaths"),
  openLogsDirectory: () => ipcRenderer.invoke("studio:openLogsDirectory"),
  getSkillEnvironment: () => ipcRenderer.invoke("studio:getSkillEnvironment"),
  openSkillDirectory: (payload) => ipcRenderer.invoke("studio:openSkillDirectory", payload),
  logRendererMessage: (payload) =>
    ipcRenderer.invoke("studio:logRendererMessage", payload && typeof payload === "object" ? payload : { message: String(payload) }),
  readWorkspacePreviewFile: (rawPath) => ipcRenderer.invoke("studio:readWorkspacePreviewFile", rawPath),
  maybeOpenWorkspaceOfficeFileExternally: (rawPath) =>
    ipcRenderer.invoke("studio:maybeOpenWorkspaceOfficeFileExternally", rawPath),
  probeGateway: () => ipcRenderer.invoke("studio:probeGateway"),
  warmGatewayChatPrep: () => ipcRenderer.invoke("studio:warmGatewayChatPrep"),
  prewarmStudioGatewaySessions: (payload) => ipcRenderer.invoke("studio:prewarmStudioGatewaySessions", payload),
  bootstrapGateway: () => ipcRenderer.invoke("studio:bootstrapGateway"),
  wechatCapability: () => ipcRenderer.invoke("studio:wechatCapability"),
  wechatAuthStart: () => ipcRenderer.invoke("studio:wechatAuthStart"),
  wechatAuthStatus: () => ipcRenderer.invoke("studio:wechatAuthStatus"),
  wechatAuthDisconnect: () => ipcRenderer.invoke("studio:wechatAuthDisconnect"),
  wechatSendMessage: (payload) => ipcRenderer.invoke("studio:wechatSendMessage", payload),
  wechatSendTyping: (payload) => ipcRenderer.invoke("studio:wechatSendTyping", payload),
  startChatStream: (payload) => ipcRenderer.invoke("studio:startChatStream", payload),
  abortChatStream: (streamId) => ipcRenderer.invoke("studio:abortChatStream", streamId),
  generateChatTitle: (payload) => ipcRenderer.invoke("studio:generateChatTitle", payload),
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
  onWechatStatus: (listener) => {
    const wrapped = (_e, data) => listener(data);
    ipcRenderer.on(WECHAT_STATUS_CHAN, wrapped);
    return () => ipcRenderer.removeListener(WECHAT_STATUS_CHAN, wrapped);
  },
});
