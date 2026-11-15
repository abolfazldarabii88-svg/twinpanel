const { app, BrowserWindow, screen } = require("electron");
const path = require("node:path");
let pishoWindow = null, hoverTimer = null, expanded = false;
function hitTest(point, bounds) {
  const cx = bounds.x + bounds.width / 2;
  const area = expanded ? {l:cx-270,r:cx+270,b:260} : {l:cx-190,r:cx+190,b:88};
  return point.x >= area.l && point.x <= area.r && point.y >= bounds.y && point.y <= bounds.y + area.b;
}
function setExpanded(value) {
  if (!pishoWindow || pishoWindow.isDestroyed() || expanded === value) return;
  expanded = value; pishoWindow.webContents.send("pisho:expanded", expanded);
}
function createWindow() {
  const display = screen.getPrimaryDisplay(), width = 620, height = 300;
  pishoWindow = new BrowserWindow({
    width,height,x:Math.round((display.workAreaSize.width-width)/2),y:0,
    frame:false,transparent:true,backgroundColor:"#00000000",resizable:false,movable:false,
    minimizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,hasShadow:false,
    focusable:false,alwaysOnTop:true,show:false,
    webPreferences:{preload:path.join(__dirname,"electron-preload.js"),contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  pishoWindow.setAlwaysOnTop(true,"screen-saver");
  pishoWindow.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  pishoWindow.setIgnoreMouseEvents(true,{forward:true});
  pishoWindow.loadFile(path.join(__dirname,"index.html"));
  pishoWindow.once("ready-to-show",()=>pishoWindow.showInactive());
  hoverTimer=setInterval(()=>{
    if(!pishoWindow||pishoWindow.isDestroyed())return;
    const over=hitTest(screen.getCursorScreenPoint(),pishoWindow.getBounds());
    pishoWindow.setIgnoreMouseEvents(!over,{forward:true}); setExpanded(over);
  },45);
  pishoWindow.on("closed",()=>{pishoWindow=null;if(hoverTimer)clearInterval(hoverTimer);hoverTimer=null;});
}
app.whenReady().then(createWindow);
app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
