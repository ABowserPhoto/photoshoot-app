"use client";

import { formatMetricValue } from "@/lib/socialMetricsModel";
import { hasPostEngagement, type PostEngagementCounts } from "@/lib/postEngagement";

type CountPart = { label: string; value: number };

function parts(counts: PostEngagementCounts): { primary: CountPart[]; extra: CountPart[] } {
  const primary: CountPart[] = [];
  const extra: CountPart[] = [];
  if (typeof counts.likes === "number") primary.push({ label: "Likes", value: counts.likes });
  if (typeof counts.comments === "number") primary.push({ label: "Comments", value: counts.comments });
  if (typeof counts.views === "number") extra.push({ label: "Views", value: counts.views });
  if (typeof counts.shares === "number") extra.push({ label: "Shares", value: counts.shares });
  if (typeof counts.saves === "number") extra.push({ label: "Saves", value: counts.saves });
  return { primary, extra };
}

function formatParts(items: CountPart[]): string {
  return items.map((item) => `${item.label} ${formatMetricValue(item.value, "count")}`).join(" · ");
}

/**
 * Desktop: revealed on hover. Touch: always-visible badge.
 * pointer-events-none so the tile's existing click and drag handlers stay the target.
 */
export default function PostEngagementOverlay({
  counts,
  tile = true,
}: {
  counts: PostEngagementCounts | null;
  /** Square scheduler tiles need a mobile badge. Cards that already list counts do not. */
  tile?: boolean;
}) {
  if (!hasPostEngagement(counts)) return null;
  const { primary, extra } = parts(counts);
  const mobile = formatParts([...primary, ...extra]);
  const primaryLine = formatParts(primary);
  const extraLine = formatParts(extra);

  return (
    <>
      {tile ? (
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-[3] max-w-[calc(100%-1rem)] -translate-x-1/2 -translate-y-1/2 rounded bg-black/70 px-2 py-0.5 text-center text-[10px] font-medium leading-snug text-zinc-100 md:hidden">
          {mobile}
        </span>
      ) : null}
      <div
        className={`pointer-events-none absolute inset-0 z-[3] hidden opacity-0 transition-opacity duration-200 group-hover:opacity-100 md:flex ${
          tile
            ? "items-center justify-center px-2 text-center"
            : "flex-col justify-end bg-gradient-to-t from-black/80 via-black/25 to-transparent p-2 pb-7"
        }`}
      >
        {tile ? (
          <div className="max-w-full rounded bg-black/70 px-2 py-1">
            {primaryLine ? <p className="text-[11px] font-semibold leading-snug text-zinc-50">{primaryLine}</p> : null}
            {extraLine ? <p className="mt-0.5 text-[10px] font-medium leading-snug text-zinc-200">{extraLine}</p> : null}
          </div>
        ) : (
          <>
            {primaryLine ? <p className="text-[11px] font-semibold leading-snug text-zinc-50">{primaryLine}</p> : null}
            {extraLine ? <p className="mt-0.5 text-[10px] font-medium leading-snug text-zinc-200">{extraLine}</p> : null}
          </>
        )}
      </div>
    </>
  );
}
