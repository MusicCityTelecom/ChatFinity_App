const { contextBridge, ipcRenderer } = require("electron");
// This bridge only works on the packaged setup screen; main rejects remote callers.
contextBridge.exposeInMainWorld("chatfinitySetup", {
  connect: (url) => ipcRenderer.invoke("connect-server", url),
});
