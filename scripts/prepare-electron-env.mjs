import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd());
const sourceEnvPath = path.join(projectRoot, ".env.production");
const targetDir = path.join(projectRoot, "electron", "runtime");
const targetEnvPath = path.join(targetDir, ".env.production");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyBundledEnv() {
  ensureDir(targetDir);

  if (!fs.existsSync(sourceEnvPath)) {
    const warning = `[prepare-electron-env] ${sourceEnvPath} not found; skipping bundled runtime env copy.`;
    console.warn(warning);
    return;
  }

  fs.copyFileSync(sourceEnvPath, targetEnvPath);
  console.info(`[prepare-electron-env] Copied ${sourceEnvPath} -> ${targetEnvPath}`);
}

copyBundledEnv();
