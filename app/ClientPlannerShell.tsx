"use client";

import type { ReactNode } from "react";

import GlobalActiveTaskWidget from "@/app/components/GlobalActiveTaskWidget";
import { PlannerGlobalProvider } from "@/app/contexts/PlannerGlobalContext";

export default function ClientPlannerShell({ children }: { children: ReactNode }) {
  return (
    <PlannerGlobalProvider>
      {children}
      <GlobalActiveTaskWidget />
    </PlannerGlobalProvider>
  );
}
