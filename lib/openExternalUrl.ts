/**
 * Open a URL in the OS default browser. In Electron, uses shell.openExternal
 * so OAuth providers are not loaded inside the embedded BrowserWindow.
 */
export function openExternalUrl(url: string): void {
  if (typeof window === "undefined" || !url.trim()) {
    return;
  }

  try {
    const electron = (
      window as typeof window & {
        require?: (module: string) => { shell?: { openExternal: (target: string) => Promise<void> } };
      }
    ).require?.("electron");
    if (electron?.shell?.openExternal) {
      void electron.shell.openExternal(url);
      return;
    }
  } catch {
    // Fall through to window.open (Electron setWindowOpenHandler also routes externally).
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
