const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const isDev = !app.isPackaged;
const DEFAULT_PORT = Number(process.env.PORT) || 3000;

let mainWindow = null;
let nextServerProcess = null;
let serverUrl = `http://localhost:${DEFAULT_PORT}`;
let serverReadyPromise = null;

function resolveStandaloneServerPath() {
  const candidates = [
    path.join(process.resourcesPath, "standalone", "server.js"),
    path.join(app.getAppPath(), "standalone", "server.js"),
    path.join(__dirname, "..", ".next", "standalone", "server.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractPortFromLog(text) {
  const patterns = [
    /started server on .*:(\d+)/i,
    /listening on .*:(\d+)/i,
    /http:\/\/127\.0\.0\.1:(\d+)/i,
    /http:\/\/localhost:(\d+)/i,
    /:(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return Number(match[1]);
    }
  }

  return null;
}

function isServerReadyLog(text) {
  return /ready in|started server on|listening on|local:/i.test(text);
}

function probeServer(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode !== undefined);
    });

    request.on("error", () => resolve(false));
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, maxAttempts = 120) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await probeServer(url)) {
      return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Next.js server did not become ready at ${url}`);
}

function startProductionServer() {
  if (serverReadyPromise) {
    return serverReadyPromise;
  }

  serverReadyPromise = new Promise((resolve, reject) => {
    const serverPath = resolveStandaloneServerPath();
    if (!serverPath) {
      reject(new Error("Standalone Next.js server bundle not found."));
      return;
    }

    const serverDir = path.dirname(serverPath);
    const port = DEFAULT_PORT;
    let resolved = false;

    const finish = async (nextPort = port) => {
      if (resolved) {
        return;
      }
      resolved = true;
      serverUrl = `http://localhost:${nextPort}`;
      try {
        await waitForServer(serverUrl);
        resolve(serverUrl);
      } catch (error) {
        reject(error);
      }
    };

    nextServerProcess = spawn(process.execPath, [serverPath], {
      cwd: serverDir,
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

    const handleLog = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(`[next] ${text}`);

      if (!isServerReadyLog(text)) {
        return;
      }

      const detectedPort = extractPortFromLog(text) ?? port;
      void finish(detectedPort);
    };

    nextServerProcess.stdout.on("data", handleLog);
    nextServerProcess.stderr.on("data", handleLog);

    nextServerProcess.on("error", (error) => {
      if (!resolved) {
        reject(error);
      }
    });

    nextServerProcess.on("exit", (code, signal) => {
      if (!resolved && code !== 0) {
        reject(new Error(`Next.js server exited (${code ?? signal ?? "unknown"}).`));
      }
    });

    window.setTimeout(() => {
      void finish(port);
    }, 30000);
  });

  return serverReadyPromise;
}

function stopProductionServer() {
  if (!nextServerProcess || nextServerProcess.killed) {
    nextServerProcess = null;
    serverReadyPromise = null;
    return;
  }

  const child = nextServerProcess;
  nextServerProcess = null;
  serverReadyPromise = null;

  child.kill("SIGTERM");

  window.setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 5000);
}

function createWindow(loadUrl = serverUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: "hidden",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadURL(loadUrl);
  mainWindow.webContents.openDevTools();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  if (isDev) {
    serverUrl = `http://localhost:${DEFAULT_PORT}`;
    await waitForServer(serverUrl);
  } else {
    serverUrl = await startProductionServer();
  }

  createWindow(serverUrl);
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error("[electron] Failed to start desktop app:", error);
  app.quit();
});

app.on("before-quit", () => {
  stopProductionServer();
});

app.on("will-quit", () => {
  stopProductionServer();
});

app.on("window-all-closed", () => {
  stopProductionServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(serverUrl);
  }
});
