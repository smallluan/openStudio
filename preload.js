const { contextBridge, ipcRenderer, webUtils } = require("electron");

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
const ORCH_EVENT_CHAN = "studio:orchestration-event";
const WECHAT_STATUS_CHAN = "studio:wechatStatus";
const PREVIEW_URL_CHAN = "studio:openPreviewUrl";
const WEBVIEW_DEVTOOLS_CHAN = "studio:openWebviewDevTools";

contextBridge.exposeInMainWorld("studioBridge", {
  getUserConfig: () => ipcRenderer.invoke("studio:getUserConfig"),
  setUserConfig: (patch) => ipcRenderer.invoke("studio:setUserConfig", patch),
  getPaths: () => ipcRenderer.invoke("studio:getPaths"),
  openLogsDirectory: () => ipcRenderer.invoke("studio:openLogsDirectory"),
  openExternalUrl: (url, opts) => ipcRenderer.invoke("studio:openExternalUrl", url, opts),
  revealLocalPath: (rawPath) => ipcRenderer.invoke("studio:revealLocalPath", rawPath),
  saveImageFromUrl: (payload) => ipcRenderer.invoke("studio:saveImageFromUrl", payload),
  getSkillEnvironment: () => ipcRenderer.invoke("studio:getSkillEnvironment"),
  openSkillDirectory: (payload) => ipcRenderer.invoke("studio:openSkillDirectory", payload),
  logRendererMessage: (payload) =>
    ipcRenderer.invoke("studio:logRendererMessage", payload && typeof payload === "object" ? payload : { message: String(payload) }),
  readWorkspacePreviewFile: (rawPath) => ipcRenderer.invoke("studio:readWorkspacePreviewFile", rawPath),
  listWorkspacePreviewDirectory: (rawPath, opts) =>
    ipcRenderer.invoke("studio:listWorkspacePreviewDirectory", rawPath, opts),
  getWorkspaceContext: (payload) => ipcRenderer.invoke("studio:getWorkspaceContext", payload),
  searchWorkspaceFiles: (payload) => ipcRenderer.invoke("studio:searchWorkspaceFiles", payload),
  checkoutGitBranch: (payload) => ipcRenderer.invoke("studio:checkoutGitBranch", payload),
  describeWorkspaceProject: (payload) => ipcRenderer.invoke("studio:describeWorkspaceProject", payload),
  pickWorkspaceFolder: () => ipcRenderer.invoke("studio:pickWorkspaceFolder"),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  statLocalPath: (rawPath) => ipcRenderer.invoke("studio:statLocalPath", rawPath),
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
  wechatSendMedia: (payload) => ipcRenderer.invoke("studio:wechatSendMedia", payload),
  resolveWechatMediaPath: (rawPath) => ipcRenderer.invoke("studio:resolveWechatMediaPath", rawPath),
  wechatSendTyping: (payload) => ipcRenderer.invoke("studio:wechatSendTyping", payload),
  getDefaultGatewayAgentId: () => ipcRenderer.invoke("studio:getDefaultGatewayAgentId"),
  provisionAgent: (payload) => ipcRenderer.invoke("studio:provisionAgent", payload),
  deleteGatewayAgent: (payload) => ipcRenderer.invoke("studio:deleteGatewayAgent", payload),
  readAgentSoul: (payload) => ipcRenderer.invoke("studio:readAgentSoul", payload),
  readAgentIdentity: (payload) => ipcRenderer.invoke("studio:readAgentIdentity", payload),
  readAgentAgents: (payload) => ipcRenderer.invoke("studio:readAgentAgents", payload),
  readAgentUser: (payload) => ipcRenderer.invoke("studio:readAgentUser", payload),
  readAgentTools: (payload) => ipcRenderer.invoke("studio:readAgentTools", payload),
  readAgentMemory: (payload) => ipcRenderer.invoke("studio:readAgentMemory", payload),
  readWorkspaceFolder: (payload) => ipcRenderer.invoke("studio:readWorkspaceFolder", payload),
  startChatStream: (payload) => ipcRenderer.invoke("studio:startChatStream", payload),
  abortChatStream: (streamId) => ipcRenderer.invoke("studio:abortChatStream", streamId),
  orchestrationCommand: (payload) => ipcRenderer.invoke("studio:orchestrationCommand", payload),
  onOrchestrationEvent: (listener) => {
    const wrapped = (_e, data) => listener(data);
    ipcRenderer.on(ORCH_EVENT_CHAN, wrapped);
    return () => ipcRenderer.removeListener(ORCH_EVENT_CHAN, wrapped);
  },
  resetTokenUsageStats: () => ipcRenderer.invoke("studio:resetTokenUsageStats"),
  getTokenUsageStats: (opts) => ipcRenderer.invoke("studio:getTokenUsageStats", opts),
  getTokenUsageRecords: (opts) => ipcRenderer.invoke("studio:getTokenUsageRecords", opts),
  listPersistedWebAccounts: () => ipcRenderer.invoke("studio:listPersistedWebAccounts"),
  clearPersistedWebAccount: (payload) => ipcRenderer.invoke("studio:clearPersistedWebAccount", payload),
  clearAllPersistedWebAccounts: () => ipcRenderer.invoke("studio:clearAllPersistedWebAccounts"),
  chatSessionsLoadAll: () => ipcRenderer.invoke("studio:chatSessionsLoadAll"),
  chatSessionsUpsert: (session) => ipcRenderer.invoke("studio:chatSessionsUpsert", session),
  chatSessionsDelete: (id) => ipcRenderer.invoke("studio:chatSessionsDelete", id),
  chatSessionsDeleteMany: (ids) => ipcRenderer.invoke("studio:chatSessionsDeleteMany", ids),
  chatSessionsImportLegacy: (sessions) => ipcRenderer.invoke("studio:chatSessionsImportLegacy", sessions),
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
  onOpenPreviewUrl: (listener) => {
    const wrapped = (_e, data) => listener(data);
    ipcRenderer.on(PREVIEW_URL_CHAN, wrapped);
    return () => ipcRenderer.removeListener(PREVIEW_URL_CHAN, wrapped);
  },
  onOpenWebviewDevTools: (listener) => {
    const wrapped = (_e, data) => listener(data);
    ipcRenderer.on(WEBVIEW_DEVTOOLS_CHAN, wrapped);
    return () => ipcRenderer.removeListener(WEBVIEW_DEVTOOLS_CHAN, wrapped);
  },
  showSystemNotification: (payload) => ipcRenderer.invoke("studio:showSystemNotification", payload),
  onSidebarActionToolRequest: (listener) => {
    const wrapped = (_e, data) => listener(data);
    ipcRenderer.on("studio:sidebarActionToolRequest", wrapped);
    return () => ipcRenderer.removeListener("studio:sidebarActionToolRequest", wrapped);
  },
  respondSidebarActionTool: (payload) =>
    ipcRenderer.invoke("studio:sidebarActionToolRespond", payload && typeof payload === "object" ? payload : {}),
  setActivePreviewGuest: (webContentsId) =>
    ipcRenderer.invoke("studio:setActivePreviewGuest", { webContentsId }),
});

ipcRenderer.on("openstudio-notification-click", (_e, data) => {
  window.dispatchEvent(new CustomEvent("openstudio-notification-click", { detail: data }));
});
