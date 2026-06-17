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

// Per-screen cell palette. "focus" = black screen, "pause" = #141414 screen.
const PALETTE = {
  focus: { empty: "#1c1c1e", exam: "#55555a" },
  pause: { empty: "#262628", exam: "#5b5b60" },
} as const;

const TODAY_BG = "#2faa5a";
const TODAY_OUTLINE = "#57d98f";

interface DayGridProps {
  days: Record<string, DayRecord>;
  todayFocusSeconds: number;
  now: Date;
  variant: "focus" | "pause";
}

export default function DayGrid({ days, todayFocusSeconds, now, variant }: DayGridProps) {
  const weeks = buildGrid(now);
  const todayStr = localDateKey(now);
  const palette = PALETTE[variant];

  return (
    <div className="w-full">
      {/* One column per week — current week left, future weeks to the right */}
      <div className="flex w-full gap-2">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-1 flex-col gap-2">
            {week.map((date) => {
              const key = localDateKey(date);
              const isToday = key === todayStr;
              const isExam = EXAM_DATES.has(key);
              const seconds = isToday
                ? todayFocusSeconds
                : (days[key]?.focusSeconds ?? 0);
              const isComplete = seconds >= FOCUS_GOAL_SECONDS - 1; // 6 h goal reached
              const hours = seconds / 3600;
              const label = isExam
                ? `${key}: Prüfungstermin`
                : `${key}: ${hours.toFixed(1)} Stunden Fokus`;

              // Today is always the green marker; completed past days fill green
              // once the goal is reached; everything else stays an empty slot.
              const backgroundColor = isToday
                ? TODAY_BG
                : isExam
                  ? palette.exam
                  : isComplete
                    ? TODAY_BG
                    : palette.empty;

              return (
                <div
                  key={key}
                  title={label}
                  aria-label={label}
                  className="aspect-square w-full rounded-[4px]"
                  style={{
                    backgroundColor,
                    ...(isToday
                      ? { outline: `2px solid ${TODAY_OUTLINE}`, outlineOffset: "1px" }
                      : null),
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
