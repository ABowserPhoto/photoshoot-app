import { exec } from "child_process";
import os from "os";

export type SupportedSoftware = "photoshop" | "lightroom" | "captureone";

export type OpenInSoftwareResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Escapes a path for use inside a shell string.
 * On Windows paths are already quoted by the caller; this handles internal quotes.
 */
function escapePathForShell(targetPath: string): string {
  // Replace any embedded double-quotes with escaped equivalents
  return targetPath.replace(/"/g, '\\"');
}

function buildCommand(
  targetPath: string,
  software: SupportedSoftware,
  platform: string
): string {
  const escaped = escapePathForShell(targetPath);

  if (platform === "darwin") {
    const appNames: Record<SupportedSoftware, string[]> = {
      photoshop: ["Adobe Photoshop 2025", "Adobe Photoshop 2024", "Adobe Photoshop 2023", "Adobe Photoshop"],
      lightroom: ["Adobe Lightroom Classic", "Lightroom Classic"],
      captureone: ["Capture One", "Capture One 23", "Capture One 22", "Capture One 21"],
    };

    // Try the primary name; macOS `open -a` will error if the app isn't found,
    // which is caught and returned as a meaningful error message.
    const primaryName = appNames[software][0];
    return `open -a "${primaryName}" "${escaped}"`;
  }

  if (platform === "win32") {
    // On Windows we invoke the software via its registered executable name.
    // Adobe software adds its install dir to PATH at install time.
    const exeNames: Record<SupportedSoftware, string> = {
      photoshop: "Photoshop.exe",
      lightroom: "lightroom.exe",
      captureone: "CaptureOne.exe",
    };

    const exe = exeNames[software];
    // Use `cmd /c start "" /b "<exe>" "<path>"` so the window doesn't flash
    // and the process is detached from Node.
    return `cmd /c start "" /b "${exe}" "${escaped}"`;
  }

  // Linux fallback — use xdg-open with the file; software-specific launch not
  // commonly needed but this at least opens something.
  return `xdg-open "${escaped}"`;
}

/**
 * Opens a local file or directory in the specified creative software.
 * Runs entirely server-side (Node.js / Electron main process environment).
 */
export function openInSoftware(
  targetPath: string,
  software: SupportedSoftware
): Promise<OpenInSoftwareResult> {
  return new Promise((resolve) => {
    if (!targetPath.trim()) {
      resolve({ ok: false, error: "No path specified." });
      return;
    }

    const platform = os.platform();
    const command = buildCommand(targetPath.trim(), software, platform);

    exec(command, { timeout: 10_000 }, (error) => {
      if (error) {
        // Provide a helpful message for the common "app not found" case
        const raw = error.message ?? String(error);
        const isNotFound =
          raw.includes("not found") ||
          raw.includes("Unable to find application") ||
          raw.includes("is not recognized") ||
          error.code === 127;

        resolve({
          ok: false,
          error: isNotFound
            ? `Could not find the application. Is the software installed?`
            : raw,
        });
      } else {
        resolve({ ok: true });
      }
    });
  });
}
