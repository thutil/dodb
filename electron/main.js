const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const express = require("express");
const { spawn } = require("child_process");

let mainWindow = null;
let serverProcess = null;
let uiServerInstance = null;
let uiProcess = null;
let isBackendRunning = false;

// Helper to resolve directory paths
function resolveAppPath(relativePath) {
  const possiblePaths = [
    path.join(__dirname, relativePath),
    path.join(__dirname, "..", relativePath),
    path.join(app.getAppPath(), relativePath),
    path.join(process.resourcesPath, relativePath),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, relativePath);
}

// Load GUI settings from data/settings.json
function loadSettings() {
  try {
    const settingsPath = resolveAppPath("data/settings.json");
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to load window settings:", err);
  }
  return { guiWidth: 1280, guiHeight: 850 };
}

// Save GUI settings to data/settings.json
function saveSettings(settings) {
  try {
    const settingsPath = resolveAppPath("data/settings.json");
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const current = loadSettings();
    fs.writeFileSync(settingsPath, JSON.stringify({ ...current, ...settings }, null, 2));
  } catch (err) {
    console.error("Failed to save window settings:", err);
  }
}

// Start Express Backend API Server (Port 5820)
function startBackendServer() {
  if (isBackendRunning) return;
  try {
    const compiledJsPath = resolveAppPath("dist/server.js");
    if (fs.existsSync(compiledJsPath)) {
      require(compiledJsPath);
      isBackendRunning = true;
      console.log("Backend compiled server started successfully from:", compiledJsPath);
    } else {
      const tsNodePath = resolveAppPath("node_modules/.bin/ts-node");
      const serverPath = resolveAppPath("src/server.ts");
      serverProcess = spawn(tsNodePath, [serverPath], {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, PORT: "5820" },
        stdio: "pipe",
      });
      isBackendRunning = true;
      console.log("Backend server process spawned via ts-node on port 5820");
    }
  } catch (err) {
    console.error("Backend exception:", err);
  }
}

// Start UI Server (Static Express or Next.js Fallback)
function startUiServer() {
  if (uiServerInstance || uiProcess) return;
  const uiOutDir = resolveAppPath("ui/out");
  const indexPath = path.join(uiOutDir, "index.html");

  if (fs.existsSync(indexPath)) {
    try {
      const uiApp = express();
      uiApp.use(express.static(uiOutDir));
      uiApp.use((req, res) => {
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send("UI not found");
        }
      });
      uiServerInstance = uiApp.listen(5821, () => {
        console.log("Production UI static server listening on port 5821 from:", uiOutDir);
      });
    } catch (err) {
      console.error("UI static server exception:", err);
    }
  } else {
    try {
      const nextPath = resolveAppPath("ui/node_modules/.bin/next");
      const uiDir = resolveAppPath("ui");
      uiProcess = spawn(nextPath, ["dev", "-p", "5821"], {
        cwd: uiDir,
        env: { ...process.env, PORT: "5821" },
        stdio: "pipe",
      });
      console.log("Fallback Next.js dev server spawned on port 5821");
    } catch (err) {
      console.error("Next.js fallback exception:", err);
    }
  }
}

function createWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  // Ensure background servers are active
  startBackendServer();
  startUiServer();

  const settings = loadSettings();

  mainWindow = new BrowserWindow({
    width: settings.guiWidth || 1280,
    height: settings.guiHeight || 850,
    minWidth: 800,
    minHeight: 550,
    titleBarStyle: "hiddenInset",
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#121216",
    icon: resolveAppPath("assets/icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false, // Disable DevTools
    },
    title: "dodb - Database Manager",
  });

  // 1. BLOCK F12, DevTools shortcuts, View Source
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const key = (input.key || "").toLowerCase();
    const isF12 = key === "f12";
    const isInspect = (input.control || input.meta) && (input.shift || input.alt) && (key === "i" || key === "j" || key === "c");
    const isViewSource = (input.control || input.meta) && key === "u";
    const isReload = (input.control || input.meta) && key === "r";

    if (isF12 || isInspect || isViewSource) {
      event.preventDefault();
    }
  });

  // 2. BLOCK Right-Click Context Menu (Inspect Element)
  mainWindow.webContents.on("context-menu", (e) => {
    e.preventDefault();
  });

  // 3. Save Window Bounds on Resize
  let resizeTimeout;
  mainWindow.on("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (mainWindow) {
        const [w, h] = mainWindow.getSize();
        saveSettings({ guiWidth: w, guiHeight: h });
      }
    }, 500);
  });

  // Watch for settings changes to update window size live
  const watchSettingsPath = resolveAppPath("data/settings.json");
  if (fs.existsSync(watchSettingsPath)) {
    fs.watch(watchSettingsPath, () => {
      try {
        const s = loadSettings();
        if (mainWindow && s.guiWidth && s.guiHeight) {
          const [currentW, currentH] = mainWindow.getSize();
          if (currentW !== s.guiWidth || currentH !== s.guiHeight) {
            mainWindow.setSize(s.guiWidth, s.guiHeight);
            mainWindow.center();
          }
        }
      } catch {}
    });
  }

  const loadUrlWithRetry = () => {
    if (!mainWindow) return;
    mainWindow.loadURL("http://localhost:5821").catch((err) => {
      console.log("Retrying UI connection to http://localhost:5821...");
      setTimeout(loadUrlWithRetry, 500);
    });
  };

  mainWindow.webContents.on("did-fail-load", (event, errorCode) => {
    if (errorCode === -102 || errorCode === -105 || errorCode === -100) {
      setTimeout(loadUrlWithRetry, 500);
    }
  });

  loadUrlWithRetry();

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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
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
  if (uiServerInstance) {
    uiServerInstance.close();
    uiServerInstance = null;
  }
  isBackendRunning = false;
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    cleanup();
    app.quit();
  }
});

app.on("before-quit", () => {
  cleanup();
});
