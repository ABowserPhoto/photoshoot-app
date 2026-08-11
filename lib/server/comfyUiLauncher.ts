import { exec } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export type LaunchComfyUIResult = { ok: true } | { ok: false; error: string };

/** Default Windows portable NVIDIA launch script. */
export const DEFAULT_COMFYUI_LAUNCH_PATH =
  "F:\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable\\run_nvidia_gpu.bat";

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
 * Normalize paths from .env files. dotenv expands escape sequences inside
 * double-quoted values, so Windows paths like `...\run_....bat` become
 * corrupted (`\r` → carriage return). Prefer forward slashes in env files;
 * still sanitize here so a bad env cannot block a valid UI path forever.
 */
function normalizeLaunchPath(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  // Undo accidental dotenv escapes that commonly appear in Windows paths.
  value = value.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  return path.normalize(value);
}

function resolveLaunchPath(batPathFromCaller: string): string {
  // Prefer COMFYUI_LAUNCH_PATH; keep COMFYUI_LAUNCH_SCRIPT as a backward-compatible alias.
  const envRaw =
    process.env.COMFYUI_LAUNCH_PATH?.trim() ||
    process.env.COMFYUI_LAUNCH_SCRIPT?.trim() ||
    "";
  const envPath = envRaw ? normalizeLaunchPath(envRaw) : "";
  const fromCaller = batPathFromCaller.trim()
    ? normalizeLaunchPath(batPathFromCaller)
    : "";

  // If env is set but points at a missing file (e.g. dotenv-corrupted path),
  // fall through to the UI path / default instead of failing hard.
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  if (fromCaller && fs.existsSync(fromCaller)) {
    return fromCaller;
  }

  if (envPath) {
    return envPath;
  }

  return fromCaller || DEFAULT_COMFYUI_LAUNCH_PATH;
}

/**
 * Launches ComfyUI in a new visible terminal window on the local machine.
 * Only meaningful when the Next.js server runs on the same host (Electron / local dev).
 *
 * Path resolution order:
 *   1. `COMFYUI_LAUNCH_PATH` (preferred)
 *   2. `COMFYUI_LAUNCH_SCRIPT` (legacy alias)
 *   3. `batPath` argument from the AI Studio UI
 *   4. Built-in NVIDIA portable default on F:\
 */
export function launchComfyUI(batPath: string): Promise<LaunchComfyUIResult> {
  return new Promise((resolve) => {
    const trimmed = resolveLaunchPath(batPath);

    if (!trimmed) {
      resolve({
        ok: false,
        error:
          "No ComfyUI launch path specified. Set COMFYUI_LAUNCH_PATH or enter the path in the UI.",
      });
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
