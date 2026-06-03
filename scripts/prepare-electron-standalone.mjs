import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");
const publicSrc = path.join(root, "public");
const publicDest = path.join(standaloneDir, "public");
const rootNodeModules = path.join(root, "node_modules");
const standaloneNodeModules = path.join(standaloneDir, "node_modules");
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

copyDir(staticSrc, staticDest);
copyDir(publicSrc, publicDest);
for (const moduleName of REQUIRED_RUNTIME_MODULES) {
  ensureRuntimeModule(moduleName);
}

console.log(
  `Prepared standalone bundle for Electron packaging and ensured runtime modules: ${REQUIRED_RUNTIME_MODULES.join(", ")}`
);
