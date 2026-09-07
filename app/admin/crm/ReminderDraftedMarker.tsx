"use client";

import { Triangle } from "lucide-react";
import { useId, useState } from "react";

import { formatReminderDatesTooltip } from "@/lib/crmReminderDates";

type ReminderDraftedMarkerProps = {
  dates: string[] | null | undefined;
};

export default function ReminderDraftedMarker({ dates }: ReminderDraftedMarkerProps) {
  const tooltip = formatReminderDatesTooltip(dates ?? []);
  const tooltipId = useId();
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  if (!tooltip) {
    return null;
  }

  const show = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setCoords({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
  };

  return (
    <span
      className="relative ml-1.5 inline-flex align-middle"
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setCoords(null)}
    >
      <span
        tabIndex={0}
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-amber-400 outline-none hover:text-amber-300 focus-visible:ring-2 focus-visible:ring-amber-400/70"
        aria-label={tooltip}
        aria-describedby={coords ? tooltipId : undefined}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setCoords(null)}
      >
        <Triangle className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
      </span>
      {coords ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-[300] w-max max-w-xs -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug text-zinc-100 shadow-xl"
          style={{ top: coords.top, left: coords.left }}
        >
          {tooltip}
        </span>
      ) : null}
    </span>
  );
}
