export const STREAK_BADGE_MIN_COUNT = 5;

type DailyStreakBadgeProps = {
  count: number;
};

export default function DailyStreakBadge({ count }: DailyStreakBadgeProps) {
  if (count < STREAK_BADGE_MIN_COUNT) {
    return null;
  }

  return (
    <div className="absolute right-4 top-4 z-40 flex items-center gap-2 rounded-full border border-orange-500 bg-orange-900/80 px-3 py-1 font-bold text-orange-400 shadow-lg">
      🔥 {count} Today
    </div>
  );
}
