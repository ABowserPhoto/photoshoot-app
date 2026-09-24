import { INACTIVITY_TIMEOUT_MS } from "@/lib/shiftCaps";

export const ELECTRON_IPC = {
  REFRESH_MAIN: "desktop-widget:refresh-main",
  REFRESH_WIDGET: "desktop-widget:refresh-widget",
  REFRESH_EVENT: "desktop-widget:refresh",
  HIDE_WIDGET: "desktop-widget:hide",
  TOGGLE_WIDGET: "desktop-widget:toggle",
  FOCUS_MAIN: "desktop-widget:focus-main",
  RESIZE_WIDGET: "desktop-widget:resize",
  SESSION_READY: "desktop-widget:session-ready",
  WIDGET_ACTIVE: "desktop-widget:active",
  TIMER_RUNNING: "desktop-widget:timer-running",
  HEARTBEAT: "desktop-widget:heartbeat",
  KEEP_ALIVE_STATUS: "desktop-widget:keep-alive-status",
} as const;

export type WidgetKeepAliveStatus = {
  visible: boolean;
  timerRunning: boolean;
  lastHeartbeatAt: number;
};

export type ElectronIpcRenderer = {
  on: (channel: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
  send: (channel: string, payload?: unknown) => void;
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
};

export function getIpcRenderer(): ElectronIpcRenderer | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const electron = (
      window as typeof window & { require?: (name: string) => { ipcRenderer?: ElectronIpcRenderer } }
    ).require?.("electron");
    return electron?.ipcRenderer ?? null;
  } catch {
    return null;
  }
}

export function isKeepAliveActive(status: WidgetKeepAliveStatus | null | undefined, now = Date.now()): boolean {
  if (!status) {
    return false;
  }
  if (status.visible || status.timerRunning) {
    return true;
  }
  return status.lastHeartbeatAt > 0 && now - status.lastHeartbeatAt <= INACTIVITY_TIMEOUT_MS;
}
