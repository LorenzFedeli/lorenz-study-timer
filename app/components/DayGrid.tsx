"use client";

import {
  buildGrid,
  FOCUS_GOAL_SECONDS,
  localDateKey,
  type DayRecord,
} from "@/app/lib/tracker";

// Exam dates (Prüfungstermine), shown muted — these are NOT completed focus
// days. Edit this list to change the markers.
const EXAM_DATES = new Set([
  "2026-07-10", // Fr, Woche 4
  "2026-07-14", // Di, Woche 5
  "2026-07-21", // Di, Woche 6
  "2026-07-24", // Fr, Woche 6
]);

interface DayGridProps {
  days: Record<string, DayRecord>;
  todayFocusSeconds: number;
  now: Date;
}

// Colours come from the per-phase CSS variables on the enclosing .screen.
export default function DayGrid({ days, todayFocusSeconds, now }: DayGridProps) {
  const weeks = buildGrid(now);
  const todayStr = localDateKey(now);

  return (
    <div className="w-full">
      {/* One column per week — current week left, future weeks to the right */}
      <div className="flex w-full gap-[7px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-1 flex-col gap-[7px]">
            {week.map((date) => {
              const key = localDateKey(date);
              const isToday = key === todayStr;
              const isExam = EXAM_DATES.has(key);
              const seconds = isToday
                ? todayFocusSeconds
                : (days[key]?.focusSeconds ?? 0);
              const fraction = Math.min(1, Math.max(0, seconds / FOCUS_GOAL_SECONDS));
              const hours = seconds / 3600;
              const label = isExam
                ? `${key}: Prüfungstermin`
                : `${key}: ${hours.toFixed(1)} Stunden Fokus`;

              return (
                <div
                  key={key}
                  title={label}
                  aria-label={label}
                  className="relative aspect-square w-full overflow-hidden rounded-[4px]"
                  style={{
                    backgroundColor: isExam ? "var(--cell-exam)" : "var(--cell-empty)",
                    ...(isToday
                      ? { outline: "2px solid var(--ring)", outlineOffset: "1px" }
                      : null),
                  }}
                >
                  {/* Focus done that day fills the cell from the bottom up. */}
                  {!isExam && fraction > 0 ? (
                    <div
                      className="absolute inset-x-0 bottom-0"
                      style={{ height: `${fraction * 100}%`, backgroundColor: "var(--fill)" }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
