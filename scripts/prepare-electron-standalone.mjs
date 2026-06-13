import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");
const serverChunksSrc = path.join(root, ".next", "server", "chunks");
const serverChunksDest = path.join(standaloneDir, ".next", "server", "chunks");
const publicSrc = path.join(root, "public");
const publicDest = path.join(standaloneDir, "public");
const comfyTemplatesSrc = path.join(root, "lib", "comfy");
const comfyTemplatesDest = path.join(standaloneDir, "lib", "comfy");
const rootNodeModules = path.join(root, "node_modules");
const standaloneNodeModules = path.join(standaloneDir, "node_modules");
const rootPackageJson = path.join(root, "package.json");
const standalonePackageJson = path.join(standaloneDir, "package.json");
const electronShellDir = path.join(root, "electron-shell");
const electronShellPackageJson = path.join(electronShellDir, "package.json");
const REQUIRED_RUNTIME_MODULES = ["next", "react", "react-dom", "styled-jsx"];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function ensureRuntimeModule(moduleName) {
  const src = path.join(rootNodeModules, ...moduleName.split("/"));
  const dest = path.join(standaloneNodeModules, ...moduleName.split("/"));

  if (!fs.existsSync(src)) {
    throw new Error(`Missing runtime module "${moduleName}" at ${src}`);
  }

  copyDir(src, dest);
}

function verifyStandaloneRuntimeModules() {
  fs.mkdirSync(standaloneNodeModules, { recursive: true });
  const missing = REQUIRED_RUNTIME_MODULES.filter((moduleName) => {
    const moduleDir = path.join(standaloneNodeModules, ...moduleName.split("/"));
    return !fs.existsSync(moduleDir);
  });

  if (missing.length > 0) {
    throw new Error(
      `Standalone bundle is missing required runtime modules: ${missing.join(", ")} (expected under ${standaloneNodeModules})`
    );
  }
}

function prepareElectronShell(rootPkg) {
  if (fs.existsSync(electronShellDir)) {
    fs.rmSync(electronShellDir, { recursive: true, force: true });
  }
  fs.mkdirSync(electronShellDir, { recursive: true });

  const shellPkg = {
    name: rootPkg.name ?? "photoshoot-app",
    version: rootPkg.version ?? "0.1.0",
    private: true,
    main: "main.js",
    description: "Studio Workflow Suite desktop shell",
    author: "Aaron Bowser Photography",
  };
  fs.writeFileSync(electronShellPackageJson, `${JSON.stringify(shellPkg, null, 2)}\n`);

  fs.copyFileSync(path.join(root, "main.js"), path.join(electronShellDir, "main.js"));
  copyDir(path.join(root, "electron"), path.join(electronShellDir, "electron"));
  fs.copyFileSync(rootPackageJson, path.join(root, "electron", "photoshoot-worker.package.json"));

  console.info(`[prepare-electron-standalone] Prepared electron-shell at ${electronShellDir}`);
}

if (!fs.existsSync(standaloneDir)) {
  console.error("Missing .next/standalone. Run `next build` first.");
  process.exit(1);
}

if (!fs.existsSync(staticSrc)) {
  console.error("Missing .next/static. Run `next build` first.");
  process.exit(1);
}

if (!fs.existsSync(publicSrc)) {
  console.error("Missing public/. Ensure the public directory exists.");
  process.exit(1);
}

if (!fs.existsSync(serverChunksSrc)) {
  console.error("Missing .next/server/chunks. Run `next build` first.");
  process.exit(1);
}

if (!fs.existsSync(rootPackageJson)) {
  console.error("Missing package.json at project root.");
  process.exit(1);
}

const rootPkg = JSON.parse(fs.readFileSync(rootPackageJson, "utf8"));
prepareElectronShell(rootPkg);

if (!fs.existsSync(standalonePackageJson)) {
  fs.copyFileSync(rootPackageJson, standalonePackageJson);
}

copyDir(staticSrc, staticDest);
copyDir(publicSrc, publicDest);
// Next standalone on Windows can miss traced server runtime chunks.
// Force-copy the full chunk directory so route runtime loading is stable.
copyDir(serverChunksSrc, serverChunksDest);
// Comfy workflow JSON templates are loaded at runtime via opaque cwd joins
// (to defeat file tracing), so they must be copied into the bundle manually.
if (fs.existsSync(comfyTemplatesSrc)) {
  copyDir(comfyTemplatesSrc, comfyTemplatesDest);
}
for (const moduleName of REQUIRED_RUNTIME_MODULES) {
  ensureRuntimeModule(moduleName);
}
verifyStandaloneRuntimeModules();

console.log(
  `Prepared standalone bundle for Electron packaging, electron-shell, synced server chunks, and verified runtime modules in ${standaloneNodeModules}: ${REQUIRED_RUNTIME_MODULES.join(", ")}`
);
