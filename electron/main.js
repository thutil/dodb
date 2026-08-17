const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let serverProcess = null;
let uiProcess = null;

function startBackendServer() {
  const serverPath = path.join(__dirname, "../src/server.ts");
  const tsNodePath = path.join(__dirname, "../node_modules/.bin/ts-node");

  serverProcess = spawn(tsNodePath, [serverPath], {
    env: { ...process.env, PORT: "3000" },
    stdio: "pipe",
  });

  serverProcess.on("error", (err) => {
    console.error("Backend server start error:", err);
  });
}

function startUiServer() {
  const nextPath = path.join(__dirname, "../ui/node_modules/.bin/next");

  uiProcess = spawn(nextPath, ["dev", "-p", "3001"], {
    cwd: path.join(__dirname, "../ui"),
    env: { ...process.env, PORT: "3001" },
    stdio: "pipe",
  });

  uiProcess.on("error", (err) => {
    console.error("UI server start error:", err);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#121216",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: "dodb - macOS Database Manager",
  });

  mainWindow.loadURL("http://localhost:3001");

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startBackendServer();
  startUiServer();

  // Wait 2s for backend & UI servers to be ready before opening window
  setTimeout(() => {
    createWindow();
  }, 2000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

function cleanup() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (uiProcess) {
    uiProcess.kill();
    uiProcess = null;
  }
}

app.on("window-all-closed", () => {
  cleanup();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  cleanup();
});
