import { exec } from "child_process";
import fs from "fs";
import os from "os";

export type LaunchComfyUIResult = { ok: true } | { ok: false; error: string };

function escapePathForShell(targetPath: string): string {
  return targetPath.replace(/"/g, '\\"');
}

function buildLaunchCommand(batPath: string, platform: string): string {
  const escaped = escapePathForShell(batPath);

  if (platform === "win32") {
    return `start cmd.exe /k "${escaped}"`;
  }

  if (platform === "darwin") {
    const osaEscaped = batPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `osascript -e 'tell application "Terminal" to activate' -e 'tell application "Terminal" to do script "${osaEscaped}"'`;
  }

  // Linux — try common terminal emulators, then fall back to running directly.
  return `gnome-terminal -- bash -c "${escaped}; exec bash" || xterm -hold -e "${escaped}" || bash -c "${escaped}"`;
}

/**
 * Launches ComfyUI in a new visible terminal window on the local machine.
 * Only meaningful when the Next.js server runs on the same host (Electron / local dev).
 */
export function launchComfyUI(batPath: string): Promise<LaunchComfyUIResult> {
  return new Promise((resolve) => {
    const trimmed = batPath.trim();
    if (!trimmed) {
      resolve({ ok: false, error: "No ComfyUI launch path specified." });
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
