const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pisho", { onExpanded: callback => ipcRenderer.on("pisho:expanded", (_event, value) => callback(!!value)) });
