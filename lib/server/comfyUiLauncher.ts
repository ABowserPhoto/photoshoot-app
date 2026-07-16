import { exec } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export type LaunchComfyUIResult = { ok: true } | { ok: false; error: string };

function escapePathForShell(targetPath: string): string {
  return targetPath.replace(/"/g, '\\"');
}

function buildLaunchCommand(batPath: string, platform: string): string {
  if (platform === "win32") {
    // cd /d switches to the correct drive (e.g. F:\) before running the script
    // so that relative paths inside the .bat file resolve correctly.
    const comfyDir = path.dirname(batPath);
    const batFile = path.basename(batPath);
    const escapedDir = escapePathForShell(comfyDir);
    const escapedFile = escapePathForShell(batFile);
    return `start cmd.exe /k "cd /d "${escapedDir}" && "${escapedFile}""`;
  }

  if (platform === "darwin") {
    const osaEscaped = batPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `osascript -e 'tell application "Terminal" to activate' -e 'tell application "Terminal" to do script "${osaEscaped}"'`;
  }

  // Linux — try common terminal emulators, then fall back to running directly.
  const escaped = escapePathForShell(batPath);
  return `gnome-terminal -- bash -c "${escaped}; exec bash" || xterm -hold -e "${escaped}" || bash -c "${escaped}"`;
}

/**
 * Launches ComfyUI in a new visible terminal window on the local machine.
 * Only meaningful when the Next.js server runs on the same host (Electron / local dev).
 *
 * Path resolution order:
 *   1. `COMFYUI_LAUNCH_SCRIPT` environment variable (set in .env.local / .env.production)
 *   2. `batPath` argument supplied by the caller (value from the AI Studio UI input)
 */
export function launchComfyUI(batPath: string): Promise<LaunchComfyUIResult> {
  return new Promise((resolve) => {
    // Prefer the server-side env var so deployments can pin the correct path
    // without relying on the browser's localStorage value.
    const envPath = process.env.COMFYUI_LAUNCH_SCRIPT?.trim();
    const trimmed = envPath || batPath.trim();

    if (!trimmed) {
      resolve({ ok: false, error: "No ComfyUI launch path specified. Set COMFYUI_LAUNCH_SCRIPT or enter the path in the UI." });
      return;
    }

    if (!fs.existsSync(trimmed)) {
      resolve({ ok: false, error: `Launch file not found: ${trimmed}` });
      return;
    }

    const platform = os.platform();
    const command = buildLaunchCommand(trimmed, platform);

    exec(command, { timeout: 10_000 }, (error) => {
      if (error) {
        const raw = error.message ?? String(error);
        const isNotFound =
          raw.includes("not found") ||
          raw.includes("is not recognized") ||
          raw.includes("Unable to find application") ||
          error.code === 127;

        resolve({
          ok: false,
          error: isNotFound
            ? "Could not open a terminal or launch ComfyUI. Check the path and that a terminal app is installed."
            : raw,
        });
      } else {
        resolve({ ok: true });
      }
    });
  });
}
