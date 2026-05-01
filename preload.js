const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  name: "Open Studio",
});
