const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

let mainWindow = null;
let serverProcess = null;
let uiServer = null;

// Start Express Backend API Server
function startBackendServer() {
  try {
    const serverFile = path.join(__dirname, "../dist/server.js");
    if (fs.existsSync(serverFile)) {
      require(serverFile);
    } else {
      const { spawn } = require("child_process");
      const tsNodePath = path.join(__dirname, "../node_modules/.bin/ts-node");
      const serverPath = path.join(__dirname, "../src/server.ts");
      serverProcess = spawn(tsNodePath, [serverPath], {
        env: { ...process.env, PORT: "3000" },
        stdio: "pipe",
      });
    }
  } catch (err) {
    console.error("Backend start error:", err);
  }
}

// Start Static UI HTTP Server for packaged app (Port 3001)
function startUiStaticServer() {
  const uiOutDir = path.join(__dirname, "../ui/out");
  if (!fs.existsSync(uiOutDir)) return;

  const serveStatic = (req, res) => {
    let filePath = path.join(uiOutDir, req.url === "/" ? "index.html" : req.url);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(uiOutDir, "index.html");
    }
    const ext = path.extname(filePath);
    const contentTypeMap = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
    };
    const contentType = contentTypeMap[ext] || "application/octet-stream";
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end("Server Error");
      } else {
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content, "utf-8");
      }
    });
  };

  uiServer = http.createServer(serveStatic);
  uiServer.listen(3001);
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
    icon: path.join(__dirname, "../assets/icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: "dodb - macOS Native Database Manager",
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
  startUiStaticServer();

  setTimeout(() => {
    createWindow();
  }, 1000);

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
  if (uiServer) {
    uiServer.close();
    uiServer = null;
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
