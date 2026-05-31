const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const isDev = !app.isPackaged;
const DEFAULT_PORT = Number(process.env.PORT) || 3000;

let mainWindow = null;
let widgetWindow = null;
let tray = null;
let nextServerProcess = null;
let serverUrl = `http://localhost:${DEFAULT_PORT}`;
let serverReadyPromise = null;

const IPC_CHANNELS = {
  REFRESH_MAIN: "desktop-widget:refresh-main",
  REFRESH_WIDGET: "desktop-widget:refresh-widget",
  REFRESH_EVENT: "desktop-widget:refresh",
  HIDE_WIDGET: "desktop-widget:hide",
  TOGGLE_WIDGET: "desktop-widget:toggle",
  FOCUS_MAIN: "desktop-widget:focus-main",
};

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
    frame: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadURL(loadUrl);
  mainWindow.webContents.openDevTools();

  mainWindow.on("minimize", () => {
    showWidgetWindow();
  });

  mainWindow.on("restore", () => {
    hideWidgetWindow();
  });

  mainWindow.on("closed", () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.close();
    }
    widgetWindow = null;
    mainWindow = null;
  });

  return mainWindow;
}

function createFloatingWidget(loadUrl = serverUrl) {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    return widgetWindow;
  }

  widgetWindow = new BrowserWindow({
    width: 320,
    height: 450,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  widgetWindow.loadURL(`${loadUrl}/desktop-widget`);

  widgetWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      widgetWindow.hide();
    }
  });

  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });

  return widgetWindow;
}

function showWidgetWindow() {
  const windowRef = createFloatingWidget(serverUrl);
  if (!windowRef || windowRef.isDestroyed()) {
    return;
  }
  windowRef.show();
  windowRef.focus();
}

function hideWidgetWindow() {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    return;
  }
  widgetWindow.hide();
}

function toggleWidgetWindow() {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    showWidgetWindow();
    return;
  }
  if (widgetWindow.isVisible()) {
    hideWidgetWindow();
  } else {
    showWidgetWindow();
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow(serverUrl);
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function resolveTrayIcon() {
  const candidates = [
    path.join(process.resourcesPath, "icon.ico"),
    path.join(app.getAppPath(), "build", "icon.ico"),
    path.join(app.getAppPath(), "public", "favicon.ico"),
    path.join(__dirname, "..", "build", "icon.ico"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) {
      return image;
    }
  }

  const executableIcon = nativeImage.createFromPath(process.execPath);
  if (!executableIcon.isEmpty()) {
    return executableIcon.resize({ width: 16, height: 16 });
  }

  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAHklEQVR4AWMYBaNgFIyCUTAKRsEoGAWjYBSMglEAAAT9AAEnjdaSAAAAAElFTkSuQmCC"
  );
}

function setupTray() {
  if (tray) {
    return tray;
  }

  tray = new Tray(resolveTrayIcon());
  tray.setToolTip("Workflow Studio");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Main App",
      click: () => {
        focusMainWindow();
      },
    },
    {
      label: "Show Quick Widget",
      click: () => {
        showWidgetWindow();
      },
    },
    {
      label: "Hide Quick Widget",
      click: () => {
        hideWidgetWindow();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    toggleWidgetWindow();
  });

  return tray;
}

function setupWidgetIpc() {
  ipcMain.removeAllListeners(IPC_CHANNELS.REFRESH_MAIN);
  ipcMain.removeAllListeners(IPC_CHANNELS.REFRESH_WIDGET);
  ipcMain.removeAllListeners(IPC_CHANNELS.HIDE_WIDGET);
  ipcMain.removeAllListeners(IPC_CHANNELS.TOGGLE_WIDGET);
  ipcMain.removeAllListeners(IPC_CHANNELS.FOCUS_MAIN);

  ipcMain.on(IPC_CHANNELS.REFRESH_MAIN, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.REFRESH_EVENT, { source: "widget" });
    }
  });

  ipcMain.on(IPC_CHANNELS.REFRESH_WIDGET, () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send(IPC_CHANNELS.REFRESH_EVENT, { source: "main" });
    }
  });

  ipcMain.on(IPC_CHANNELS.HIDE_WIDGET, () => {
    hideWidgetWindow();
  });

  ipcMain.on(IPC_CHANNELS.TOGGLE_WIDGET, () => {
    toggleWidgetWindow();
  });

  ipcMain.on(IPC_CHANNELS.FOCUS_MAIN, () => {
    focusMainWindow();
    hideWidgetWindow();
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
  createFloatingWidget(serverUrl);
  setupWidgetIpc();
  setupTray();
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error("[electron] Failed to start desktop app:", error);
  app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopProductionServer();
});

app.on("will-quit", () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
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
