"use client";

import {
  buildGrid,
  fillReferenceForDateKey,
  isCountUpDay,
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
  todayTrackedSeconds: number;
  now: Date;
}

// Colours come from the per-phase CSS variables on the enclosing .screen.
export default function DayGrid({ days, todayTrackedSeconds, now }: DayGridProps) {
  const weeks = buildGrid(now);
  const todayStr = localDateKey(now);

  return (
    <div className="w-full">
      {/* One row per week — current week on top, future weeks below (Mon–Sun) */}
      <div className="flex w-full flex-col gap-[7px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex w-full gap-[7px]">
            {week.map((date) => {
              const key = localDateKey(date);
              const isToday = key === todayStr;
              const isExam = EXAM_DATES.has(key);
              const isFree = isCountUpDay(key); // Sunday rest day
              const seconds = isToday
                ? todayTrackedSeconds
                : (days[key]?.focusSeconds ?? 0);
              // Fill is relative to the day's scale: its goal (6 h weekday /
              // 3 h Saturday), or a soft reference on Sunday's count-up day.
              const fraction = Math.min(1, Math.max(0, seconds / fillReferenceForDateKey(key)));
              const hours = seconds / 3600;
              const label = isExam
                ? `${key}: Prüfungstermin`
                : isFree
                  ? `${key}: ${hours.toFixed(1)} Stunden frei`
                  : `${key}: ${hours.toFixed(1)} Stunden Fokus`;

              return (
                <div
                  key={key}
                  title={label}
                  aria-label={label}
                  className="relative aspect-square flex-1 overflow-hidden rounded-[4px]"
                  style={{
                    backgroundColor: isExam ? "var(--cell-exam)" : "var(--cell-empty)",
                    ...(isToday
                      ? { outline: "2px solid var(--ring)", outlineOffset: "1px" }
                      : null),
                  }}
                >
                  {/* Tracked time that day fills the cell from the bottom up.
                      Sunday free time uses a distinct colour from focus. */}
                  {!isExam && fraction > 0 ? (
                    <div
                      className="absolute inset-x-0 bottom-0"
                      style={{
                        height: `${fraction * 100}%`,
                        backgroundColor: isFree ? "var(--free)" : "var(--fill)",
                      }}
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
