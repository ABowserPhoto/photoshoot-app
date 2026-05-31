"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

import GlobalActiveTaskWidget from "@/app/components/GlobalActiveTaskWidget";
import { PlannerGlobalProvider } from "@/app/contexts/PlannerGlobalContext";

type IpcRendererBridge = {
  on: (channel: string, listener: () => void) => void;
  removeListener: (channel: string, listener: () => void) => void;
};

export default function ClientPlannerShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const electron = (
      window as typeof window & {
        require?: (name: string) => { ipcRenderer?: IpcRendererBridge } | undefined;
      }
    ).require?.("electron");
    const ipc = electron?.ipcRenderer;
    if (!ipc) {
      return;
    }

    const listener = () => {
      window.dispatchEvent(new Event("desktop-widget:refresh"));
    };

    ipc.on("desktop-widget:refresh", listener);
    return () => {
      ipc.removeListener("desktop-widget:refresh", listener);
    };
  }, []);

  return (
    <PlannerGlobalProvider>
      {children}
      <GlobalActiveTaskWidget />
    </PlannerGlobalProvider>
  );
}
