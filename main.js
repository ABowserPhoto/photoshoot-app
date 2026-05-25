const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const isDev = !app.isPackaged;
const port = Number(process.env.PORT) || 3000;
const serverUrl = `http://localhost:${port}`;

let mainWindow = null;
let nextServerProcess = null;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(url);
  mainWindow.webContents.openDevTools();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function probeServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeServer(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Next.js server did not become ready at ${url}`);
}

function resolveStandaloneServerPath() {
  const candidates = [
    path.join(process.resourcesPath, "standalone", "server.js"),
    path.join(app.getAppPath(), "standalone", "server.js"),
    path.join(__dirname, ".next", "standalone", "server.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function startPackagedNextServer() {
  const serverPath = resolveStandaloneServerPath();
  if (!serverPath) {
    throw new Error("Standalone Next.js server bundle not found.");
  }

  nextServerProcess = spawn(process.execPath, [serverPath], {
    cwd: path.dirname(serverPath),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  nextServerProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[next] ${chunk.toString()}`);
  });
  nextServerProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[next] ${chunk.toString()}`);
  });

  await waitForServer(serverUrl, 90_000);
}

function stopPackagedNextServer() {
  if (!nextServerProcess || nextServerProcess.killed) {
    nextServerProcess = null;
    return;
  }
  const child = nextServerProcess;
  nextServerProcess = null;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 5000);
}

async function bootstrap() {
  if (isDev) {
    await waitForServer(serverUrl, 90_000);
  } else {
    await startPackagedNextServer();
  }
  createWindow(serverUrl);
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error("[electron] Startup failed:", error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(serverUrl);
  }
});

app.on("before-quit", stopPackagedNextServer);

app.on("window-all-closed", () => {
  stopPackagedNextServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
