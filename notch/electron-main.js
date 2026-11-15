const { app, BrowserWindow } = require("electron");
const path = require("node:path");

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 520,
    minWidth: 640,
    minHeight: 420,
    title: "Pisho — Character Preview",
    backgroundColor: "#080808",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
