const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

function parseEnvFile(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function applyEnvFile(filePath) {
  const parsed = parseEnvFile(fs.readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

const isDev = !app.isPackaged;
loadBundledProductionEnv();
loadDevLocalEnv();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const DEFAULT_COMFYUI_PATH = "C:/ComfyUI_windows_portable/ComfyUI";
const BRAND_ICON_RELATIVE_PATH = path.join("build", "icon.ico");

let mainWindow = null;
let widgetWindow = null;
let tray = null;
let nextServerProcess = null;
let photoWorkerProcess = null;
let comfyUiProcess = null;
let serverUrl = `http://localhost:${DEFAULT_PORT}`;
let serverReadyPromise = null;

function loadDevLocalEnv() {
  if (!isDev) {
    return;
  }

  const candidates = [
    path.join(__dirname, "..", ".env.local"),
    path.join(process.cwd(), ".env.local"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      applyEnvFile(candidate);
      console.info(`[env] Loaded dev env from: ${candidate}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[env] Failed loading dev env (${candidate}): ${message}`);
    }
  }
}

function loadBundledProductionEnv() {
  if (isDev) {
    return;
  }

  const candidates = [
    path.join(app.getAppPath(), "electron", "runtime", ".env.production"),
    path.join(process.resourcesPath, "app.asar", "electron", "runtime", ".env.production"),
    path.join(process.resourcesPath, "electron", "runtime", ".env.production"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      applyEnvFile(candidate);
      console.info(`[env] Loaded bundled runtime env from: ${candidate}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[env] Failed loading bundled runtime env (${candidate}): ${message}`);
    }
  }
}

const IPC_CHANNELS = {
  REFRESH_MAIN: "desktop-widget:refresh-main",
  REFRESH_WIDGET: "desktop-widget:refresh-widget",
  REFRESH_EVENT: "desktop-widget:refresh",
  HIDE_WIDGET: "desktop-widget:hide",
  TOGGLE_WIDGET: "desktop-widget:toggle",
  FOCUS_MAIN: "desktop-widget:focus-main",
};

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, "..", BRAND_ICON_RELATIVE_PATH),
    path.join(app.getAppPath(), BRAND_ICON_RELATIVE_PATH),
    path.join(process.resourcesPath, "icon.ico"),
    path.join(process.resourcesPath, "app.asar", BRAND_ICON_RELATIVE_PATH),
    path.join(app.getAppPath(), "public", "favicon.ico"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

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

function resolveStandaloneNodePath(serverDir) {
  const candidates = [
    path.join(serverDir, "node_modules"),
    path.join(serverDir, ".next", "node_modules"),
    path.join(process.resourcesPath, "standalone", "node_modules"),
    path.join(process.resourcesPath, "standalone", ".next", "node_modules"),
    path.join(app.getAppPath(), "standalone", "node_modules"),
    path.join(app.getAppPath(), "node_modules"),
    path.join(process.resourcesPath, "app.asar", "node_modules"),
    path.join(process.resourcesPath, "node_modules"),
  ];

  return candidates.filter((candidate, index) => fs.existsSync(candidate) && candidates.indexOf(candidate) === index);
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
    const nodePathEntries = resolveStandaloneNodePath(serverDir);

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
        NODE_PATH: nodePathEntries.join(path.delimiter),
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

    setTimeout(() => {
      void finish(port);
    }, 30000);
  });

  return serverReadyPromise;
}

function resolveAppRoot() {
  const candidates = [
    process.env.PHOTO_WORKER_APP_ROOT?.trim(),
    isDev ? path.join(__dirname, "..") : null,
    process.cwd(),
    path.join(process.resourcesPath, "photoshoot-worker"),
    path.join(process.resourcesPath, "app.asar.unpacked"),
    path.dirname(app.getPath("exe")),
    app.getAppPath(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (
      fs.existsSync(path.join(resolved, "package.json")) ||
      fs.existsSync(path.join(resolved, "scripts", "processing-worker.mjs"))
    ) {
      return resolved;
    }
  }

  return isDev ? path.join(__dirname, "..") : path.dirname(app.getPath("exe"));
}

function readPackageJson(appRoot) {
  const pkgPath = path.join(appRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[photo-worker] Failed to parse package.json at ${pkgPath}: ${message}`);
    return null;
  }
}

function resolvePhotoWorkerScriptFromPackageJson(appRoot) {
  const pkg = readPackageJson(appRoot);
  const workerCmd = typeof pkg?.scripts?.worker === "string" ? pkg.scripts.worker.trim() : "";
  if (!workerCmd) {
    return null;
  }

  const nodeMatch = workerCmd.match(/\bnode\s+(.+)$/i);
  if (nodeMatch?.[1]) {
    const scriptRef = nodeMatch[1].trim().replace(/^["']|["']$/g, "");
    return path.resolve(appRoot, scriptRef);
  }

  const tsxMatch = workerCmd.match(/\btsx\s+(.+)$/i);
  if (tsxMatch?.[1]) {
    const scriptRef = tsxMatch[1].trim().replace(/^["']|["']$/g, "");
    return path.resolve(appRoot, scriptRef);
  }

  return null;
}

function resolvePhotoWorkerScript() {
  const fromEnv = process.env.PHOTO_WORKER_SCRIPT?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }

  const appRoot = resolveAppRoot();
  const candidates = [
    resolvePhotoWorkerScriptFromPackageJson(appRoot),
    path.join(appRoot, "scripts", "processing-worker.mjs"),
    path.join(__dirname, "..", "scripts", "processing-worker.mjs"),
    path.join(process.cwd(), "scripts", "processing-worker.mjs"),
    path.join(process.resourcesPath, "photoshoot-worker", "scripts", "processing-worker.mjs"),
    path.join(process.resourcesPath, "scripts", "processing-worker.mjs"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  console.warn("[photo-worker] Could not find worker script. Checked:", candidates);
  return null;
}

function resolveNodeExecutable(appRoot) {
  const explicit = process.env.PHOTO_WORKER_NODE?.trim();
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const npmNode = process.env.npm_node_execpath?.trim();
  if (npmNode && fs.existsSync(npmNode)) {
    return npmNode;
  }

  const standaloneNode = path.join(process.resourcesPath, "standalone", "node_modules", ".bin", "node");
  if (!isDev && fs.existsSync(standaloneNode)) {
    return standaloneNode;
  }

  return process.platform === "win32" ? "node.exe" : "node";
}

function resolveStandaloneNodeModulesPath() {
  const candidates = [
    path.join(process.resourcesPath, "standalone", "node_modules"),
    path.join(process.resourcesPath, "standalone", ".next", "node_modules"),
    path.join(resolveAppRoot(), "node_modules"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function canUseNpmWorker(appRoot) {
  if (process.env.PHOTO_WORKER_USE_NPM?.trim() === "0") {
    return false;
  }

  const pkg = readPackageJson(appRoot);
  if (!pkg?.scripts?.worker) {
    return false;
  }

  return fs.existsSync(path.join(appRoot, "node_modules"));
}

function resolvePhotoWorkerLaunchSpec() {
  const appRoot = resolveAppRoot();
  const workerScript = resolvePhotoWorkerScript();
  const nodeModulesPath = resolveStandaloneNodeModulesPath();
  const sharedEnv = {
    NODE_ENV: process.env.NODE_ENV || (isDev ? "development" : "production"),
    ...(nodeModulesPath ? { NODE_PATH: nodeModulesPath } : {}),
  };

  if (canUseNpmWorker(appRoot)) {
    return {
      label: "photo-worker",
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      args: ["run", "worker"],
      cwd: appRoot,
      env: sharedEnv,
    };
  }

  if (!workerScript) {
    return null;
  }

  const ext = path.extname(workerScript).toLowerCase();
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") {
    const tsxCmd = path.join(appRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
    if (fs.existsSync(tsxCmd)) {
      return {
        label: "photo-worker",
        command: tsxCmd,
        args: [workerScript],
        cwd: appRoot,
        shell: process.platform === "win32",
        env: sharedEnv,
      };
    }

    return {
      label: "photo-worker",
      command: process.platform === "win32" ? "npx.cmd" : "npx",
      args: ["tsx", workerScript],
      cwd: appRoot,
      env: sharedEnv,
    };
  }

  const nodeExe = resolveNodeExecutable(appRoot);
  const useElectronAsNode =
    process.env.PHOTO_WORKER_USE_ELECTRON_NODE?.trim() === "1" ||
    (!isDev && nodeExe === "node.exe" && !process.env.npm_node_execpath && !process.env.PHOTO_WORKER_NODE);

  return {
    label: "photo-worker",
    command: useElectronAsNode ? process.execPath : nodeExe,
    args: [workerScript],
    cwd: appRoot,
    shell: !useElectronAsNode && process.platform === "win32" && nodeExe === "node.exe",
    env: useElectronAsNode
      ? {
          ...sharedEnv,
          ELECTRON_RUN_AS_NODE: "1",
        }
      : sharedEnv,
  };
}

function resolveComfyUiLaunch() {
  const launchScript = process.env.COMFYUI_LAUNCH_SCRIPT?.trim();
  if (launchScript) {
    if (!fs.existsSync(launchScript)) {
      throw new Error(`COMFYUI_LAUNCH_SCRIPT not found: ${launchScript}`);
    }
    return {
      label: "comfyui",
      command: process.platform === "win32" ? "cmd.exe" : launchScript,
      args: process.platform === "win32" ? ["/c", launchScript] : [],
      cwd: path.dirname(launchScript),
    };
  }

  const comfyRoot = process.env.COMFYUI_PATH?.trim() || DEFAULT_COMFYUI_PATH;
  const comfyRootResolved = path.resolve(comfyRoot);
  const portableRoot = path.resolve(comfyRootResolved, "..");

  const batCandidates = [
    process.env.COMFYUI_RUN_SCRIPT?.trim(),
    path.join(portableRoot, "run_nvidia_gpu.bat"),
    path.join(portableRoot, "run_nvidia_gpu_fast_fp16_accumulation.bat"),
    path.join(portableRoot, "run_cpu.bat"),
  ].filter(Boolean);

  for (const batPath of batCandidates) {
    if (fs.existsSync(batPath)) {
      return {
        label: "comfyui",
        command: "cmd.exe",
        args: ["/c", batPath],
        cwd: portableRoot,
      };
    }
  }

  const mainPy = path.join(comfyRootResolved, "main.py");
  if (!fs.existsSync(mainPy)) {
    throw new Error(
      `ComfyUI launch script not found. Set COMFYUI_LAUNCH_SCRIPT or COMFYUI_PATH (looked under ${portableRoot}).`
    );
  }

  const embeddedPython = path.join(portableRoot, "python_embeded", "python.exe");
  const pythonCommand = process.env.COMFYUI_PYTHON?.trim()
    || (fs.existsSync(embeddedPython) ? embeddedPython : "python");
  const comfyPort = process.env.COMFYUI_PORT?.trim() || "8188";
  const comfyHost = process.env.COMFYUI_HOST?.trim() || "127.0.0.1";

  return {
    label: "comfyui",
    command: pythonCommand,
    args: [mainPy, "--listen", comfyHost, "--port", comfyPort],
    cwd: comfyRootResolved,
  };
}

function pipeChildLogs(label, child) {
  if (!child.stdout) {
    return;
  }
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });
}

function spawnManagedProcess(spec) {
  const command = typeof spec.command === "string" ? spec.command.trim() : "";
  if (!command) {
    throw new Error(`[${spec.label ?? "process"}] spawn aborted: command is missing or invalid.`);
  }

  const args = Array.isArray(spec.args) ? spec.args.map((arg) => String(arg)) : [];

  const child = spawn(command, args, {
    cwd: spec.cwd,
    env: {
      ...process.env,
      ...(spec.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
    shell: process.platform === "win32" || Boolean(spec.shell),
  });

  pipeChildLogs(spec.label, child);

  child.on("error", (error) => {
    console.error(`[${spec.label}] process error:`, error);
  });

  child.on("exit", (code, signal) => {
    console.info(`[${spec.label}] exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    if (spec.label === "photo-worker" && photoWorkerProcess === child) {
      photoWorkerProcess = null;
    }
    if (spec.label === "comfyui" && comfyUiProcess === child) {
      comfyUiProcess = null;
    }
  });

  return child;
}

function killProcessTree(child) {
  if (!child || child.killed) {
    return;
  }

  const pid = child.pid;
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch (error) {
      console.warn(`[electron] taskkill failed for pid ${pid}:`, error);
      child.kill("SIGKILL");
    }
    return;
  }

  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 5000);
}

function startPhotoWorker() {
  if (photoWorkerProcess && !photoWorkerProcess.killed) {
    return photoWorkerProcess;
  }

  const launchSpec = resolvePhotoWorkerLaunchSpec();
  if (!launchSpec) {
    console.warn(
      "[photo-worker] Could not resolve worker launch command. Set PHOTO_WORKER_SCRIPT or run from the project root with package.json scripts.worker."
    );
    return null;
  }

  photoWorkerProcess = spawnManagedProcess(launchSpec);
  console.info(
    `[photo-worker] Started (pid=${photoWorkerProcess.pid}) -> ${launchSpec.command} ${launchSpec.args.join(" ")} (cwd=${launchSpec.cwd})`
  );
  return photoWorkerProcess;
}

function startComfyUi() {
  if (comfyUiProcess && !comfyUiProcess.killed) {
    return comfyUiProcess;
  }

  try {
    const launch = resolveComfyUiLaunch();
    comfyUiProcess = spawnManagedProcess(launch);
    console.info(
      `[comfyui] Started (pid=${comfyUiProcess.pid}) -> ${launch.command} ${launch.args.join(" ")}`
    );
    return comfyUiProcess;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[comfyui] Not started: ${message}`);
    return null;
  }
}

function startManagedChildProcesses() {
  startPhotoWorker();
  startComfyUi();
}

function stopManagedChildProcesses() {
  const workers = [photoWorkerProcess, comfyUiProcess].filter(Boolean);
  for (const child of workers) {
    killProcessTree(child);
  }
  photoWorkerProcess = null;
  comfyUiProcess = null;
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

  setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 5000);
}

function createWindow(loadUrl = serverUrl) {
  const appIconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: true,
    icon: appIconPath ?? undefined,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: isDev,
    },
  });

  mainWindow.loadURL(loadUrl);
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

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

  const appIconPath = resolveAppIconPath();
  widgetWindow = new BrowserWindow({
    width: 320,
    height: 450,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    icon: appIconPath ?? undefined,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: isDev,
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
  const appIconPath = resolveAppIconPath();
  if (appIconPath) {
    const image = nativeImage.createFromPath(appIconPath);
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
  startManagedChildProcesses();

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
  stopManagedChildProcesses();
  stopProductionServer();
});

app.on("will-quit", () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  stopManagedChildProcesses();
  stopProductionServer();
});

app.on("window-all-closed", () => {
  stopManagedChildProcesses();
  stopProductionServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopManagedChildProcesses();
    stopProductionServer();
    app.quit();
  });
}

process.on("exit", () => {
  stopManagedChildProcesses();
  stopProductionServer();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(serverUrl);
  }
});
