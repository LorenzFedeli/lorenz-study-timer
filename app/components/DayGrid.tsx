"use client";

import {
  buildGrid,
  FOCUS_GOAL_SECONDS,
  localDateKey,
  type DayRecord,
} from "@/app/lib/tracker";

// Exam dates (Prüfungstermine), shown in a lighter gray — these are NOT
// completed focus days. Edit this list to change the markers.
const EXAM_DATES = new Set([
  "2026-07-10", // Fr, Woche 4
  "2026-07-14", // Di, Woche 5
  "2026-07-21", // Di, Woche 6
  "2026-07-24", // Fr, Woche 6
]);

// Dark → bright green by focus fraction. Empty days stay a near-black slot.
function cellColor(fraction: number): string {
  if (fraction <= 0) return "var(--cell-empty)";
  const lightness = 20 + Math.min(1, fraction) * 40; // 20% … 60%
  return `hsl(142 65% ${lightness}%)`;
}

interface DayGridProps {
  days: Record<string, DayRecord>;
  todayFocusSeconds: number;
  now: Date;
}

export default function DayGrid({ days, todayFocusSeconds, now }: DayGridProps) {
  const weeks = buildGrid(now);
  const todayStr = localDateKey(now);

  return (
    <div className="w-full">
      {/* One column per week — current week left, future weeks to the right */}
      <div className="flex justify-between gap-[6px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[6px]">
            {week.map((date) => {
              const key = localDateKey(date);
              const isToday = key === todayStr;
              const isExam = EXAM_DATES.has(key);
              const seconds = isToday
                ? todayFocusSeconds
                : (days[key]?.focusSeconds ?? 0);
              const hours = seconds / 3600;
              const label = isExam
                ? `${key}: Prüfungstermin`
                : `${key}: ${hours.toFixed(1)} Stunden Fokus`;
              return (
                <div
                  key={key}
                  title={label}
                  aria-label={label}
                  className={`h-[18px] w-[18px] rounded-[4px] ${
                    isToday ? "ring-2 ring-white/80" : ""
                  }`}
                  style={{
                    backgroundColor: isExam
                      ? "var(--cell-exam)"
                      : cellColor(seconds / FOCUS_GOAL_SECONDS),
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
