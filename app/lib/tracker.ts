// Pure, isomorphic tracker logic shared by client UI and server route handlers.
// No React, no Blob, no browser/server-only APIs in here.

export const WEEKDAY_FOCUS_GOAL_SECONDS = 6 * 60 * 60; // 6 h focus goal Mon–Fri
export const SATURDAY_FOCUS_GOAL_SECONDS = 3 * 60 * 60; // 3 h focus goal on Saturday
// Sunday is a rest day with no goal — just an optional count-up stopwatch. This
// is only the visual fill scale for Sunday cells in the grid, not a target.
export const SUNDAY_FILL_REFERENCE_SECONDS = 3 * 60 * 60;
// Largest amount of tracked time we persist for a single day (count-up cap).
export const DAY_MAX_SECONDS = 24 * 60 * 60;
// Back-compat constant: the weekday goal, also the highest countdown goal.
export const FOCUS_GOAL_SECONDS = WEEKDAY_FOCUS_GOAL_SECONDS;
export const FOCUS_BLOCK_SECONDS = 90 * 60; // 90 min focus block
export const BREAK_SECONDS = 5 * 60; // 5 min break between blocks
export const FOCUS_BLOCKS = FOCUS_GOAL_SECONDS / FOCUS_BLOCK_SECONDS; // = 4 (weekday max)
export const GRID_WEEKS = 6;

// "free" is Sunday's count-up stopwatch (no goal, no blocks, no break).
export type Phase = "idle" | "focus" | "break" | "lunch" | "free";

// Rich runtime snapshot. The values are correct as of `anchorMs`; while
// `running` is true they are extrapolated forward with `project()`.
export interface TimerSnapshot {
  phase: Phase;
  running: boolean;
  remainingFocusSeconds: number; // remaining focus toward the 6 h goal
  blockElapsedSeconds: number; // focus seconds done inside the current 90-min block
  breakElapsedSeconds: number; // seconds into the current 5-min break
  lunchElapsedSeconds: number; // seconds into the current lunch break
  freeElapsedSeconds: number; // count-up free time tracked on Sunday (rest day)
  underlyingPhase: Phase; // phase to resume once lunch ends (focus | break)
  anchorMs: number; // Date.now() reference for the values above
  dateKey: string; // local YYYY-MM-DD this timer belongs to
}

export interface DayRecord {
  focusSeconds: number;
}

// The timer fields persisted server-side — a full, projectable snapshot so any
// device can resume the exact live position on load. `anchorMs` is an absolute
// Date.now() timestamp; `lastUpdated` drives last-writer-wins across devices.
export interface PersistedTimer {
  phase: Phase;
  running: boolean;
  remainingFocusSeconds: number;
  blockElapsedSeconds: number;
  breakElapsedSeconds: number;
  lunchElapsedSeconds: number;
  freeElapsedSeconds: number;
  underlyingPhase: Phase;
  anchorMs: number;
  dateKey: string;
  lastUpdated: string; // ISO string
}

// The canonical JSON persisted server-side (and echoed by the API).
export interface TrackerState {
  days: Record<string, DayRecord>;
  timer: PersistedTimer;
}

// What we keep in localStorage for instant, precise local resume.
export interface LocalCache {
  days: Record<string, DayRecord>;
  timer: TimerSnapshot;
  updatedAt?: number; // ms epoch of the last local save (freshness vs. server)
}

export const STORAGE_KEY = "time-tracker:v1";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Date helpers — everything in the user's local timezone.
// ---------------------------------------------------------------------------

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayKey(now: Date = new Date()): string {
  return localDateKey(now);
}

// Weekday (0 = Sun … 6 = Sat) for a local "YYYY-MM-DD" key. Returns -1 for an
// empty/malformed key so callers fall back to weekday behaviour.
function dayOfWeekForKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return -1;
  return new Date(y, m - 1, d).getDay();
}

export type DayKind = "weekday" | "saturday" | "sunday";

// What kind of day a local "YYYY-MM-DD" key is. Saturday is a short (3 h)
// countdown day; Sunday is a rest day with an optional count-up stopwatch.
export function dayKindForKey(dateKey: string): DayKind {
  const day = dayOfWeekForKey(dateKey);
  if (day === 0) return "sunday";
  if (day === 6) return "saturday";
  return "weekday";
}

// Sunday tracks free time by counting up, so it has no countdown / goal.
export function isCountUpDay(dateKey: string): boolean {
  return dayKindForKey(dateKey) === "sunday";
}

// The focus countdown goal: 6 h on weekdays, 3 h on Saturday, 0 on Sunday.
export function goalSecondsForDateKey(dateKey: string): number {
  switch (dayKindForKey(dateKey)) {
    case "saturday":
      return SATURDAY_FOCUS_GOAL_SECONDS;
    case "sunday":
      return 0;
    default:
      return WEEKDAY_FOCUS_GOAL_SECONDS;
  }
}

// Visual fill scale for a grid cell. Countdown days fill toward their goal;
// Sunday fills toward a soft reference so logged free time stays visible.
export function fillReferenceForDateKey(dateKey: string): number {
  return isCountUpDay(dateKey) ? SUNDAY_FILL_REFERENCE_SECONDS : goalSecondsForDateKey(dateKey);
}

// Largest tracked time we persist for a day: its countdown goal, or the
// count-up cap on Sunday.
export function storeCapForDateKey(dateKey: string): number {
  return isCountUpDay(dateKey) ? DAY_MAX_SECONDS : goalSecondsForDateKey(dateKey);
}

// Number of 90-min focus blocks for a day (4 weekdays, 2 Saturday, 0 Sunday).
export function blocksForDateKey(dateKey: string): number {
  return Math.round(goalSecondsForDateKey(dateKey) / FOCUS_BLOCK_SECONDS);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Monday of the week containing `d` (week starts Monday).
export function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0 = Sun … 6 = Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(startOfDay(d), diff);
}

// Build the planner grid: GRID_WEEKS columns starting with the current week on
// the left and extending forward into the future on the right. Each column has
// the full 7 days Mon–Sun (weekends carry the lighter 3 h goal).
export function buildGrid(now: Date = new Date()): Date[][] {
  const thisMonday = mondayOf(now);
  const weeks: Date[][] = [];
  for (let w = 0; w < GRID_WEEKS; w++) {
    const weekMonday = addDays(thisMonday, 7 * w);
    const days: Date[] = [];
    for (let d = 0; d < 7; d++) days.push(addDays(weekMonday, d));
    weeks.push(days);
  }
  return weeks;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// Always H:MM:SS — used for the big 6 h focus countdown (stable width).
export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad2(m)}:${pad2(s % 60)}`;
}

// M:SS (or H:MM:SS past an hour) — used for break / lunch sub-timers.
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

// ---------------------------------------------------------------------------
// Timer core
// ---------------------------------------------------------------------------

export function freshTimer(dateKey: string, now: number): TimerSnapshot {
  return {
    phase: "idle",
    running: false,
    remainingFocusSeconds: goalSecondsForDateKey(dateKey),
    blockElapsedSeconds: 0,
    breakElapsedSeconds: 0,
    lunchElapsedSeconds: 0,
    freeElapsedSeconds: 0,
    underlyingPhase: "idle",
    anchorMs: now,
    dateKey,
  };
}

// Advance a snapshot to `now` using real elapsed time. Handles crossing block
// and break boundaries (possibly several at once after a long background gap)
// and stops automatically once the 6 h goal is reached. Pure: returns a new
// snapshot whose values are exact as of `now`.
export function project(s: TimerSnapshot, now: number): TimerSnapshot {
  if (!s.running || s.phase === "idle") {
    return { ...s, anchorMs: now };
  }

  let elapsed = (now - s.anchorMs) / 1000;
  if (elapsed <= 0) return { ...s, anchorMs: now };

  if (s.phase === "lunch") {
    return {
      ...s,
      lunchElapsedSeconds: s.lunchElapsedSeconds + elapsed,
      anchorMs: now,
    };
  }

  if (s.phase === "free") {
    // Sunday rest-day stopwatch — just count free time up.
    return {
      ...s,
      freeElapsedSeconds: s.freeElapsedSeconds + elapsed,
      anchorMs: now,
    };
  }

  let phase = s.phase;
  let remaining = s.remainingFocusSeconds;
  let blockElapsed = s.blockElapsedSeconds;
  let breakElapsed = s.breakElapsedSeconds;

  while (elapsed > 1e-9) {
    if (phase === "focus") {
      const untilBlockEnd = FOCUS_BLOCK_SECONDS - blockElapsed;
      const step = Math.min(elapsed, untilBlockEnd, remaining);
      blockElapsed += step;
      remaining -= step;
      elapsed -= step;

      if (remaining <= 1e-6) {
        // Whole 6 h goal reached → stop.
        return {
          ...s,
          phase: "idle",
          running: false,
          remainingFocusSeconds: 0,
          blockElapsedSeconds: 0,
          breakElapsedSeconds: 0,
          underlyingPhase: "idle",
          anchorMs: now,
        };
      }
      if (blockElapsed >= FOCUS_BLOCK_SECONDS - 1e-6) {
        // 90-min block done → switch to a 5-min break.
        phase = "break";
        blockElapsed = 0;
        breakElapsed = 0;
      }
    } else {
      // break
      const untilBreakEnd = BREAK_SECONDS - breakElapsed;
      const step = Math.min(elapsed, untilBreakEnd);
      breakElapsed += step;
      elapsed -= step;
      if (breakElapsed >= BREAK_SECONDS - 1e-6) {
        // Break over → next focus block starts automatically.
        phase = "focus";
        blockElapsed = 0;
        breakElapsed = 0;
      }
    }
  }

  return {
    ...s,
    phase,
    remainingFocusSeconds: remaining,
    blockElapsedSeconds: blockElapsed,
    breakElapsedSeconds: breakElapsed,
    underlyingPhase: phase,
    anchorMs: now,
  };
}

// Tracked seconds for the day behind a live snapshot: focus done toward the
// goal on countdown days (6 h weekday / 3 h Saturday), or free time counted up
// on Sunday (the rest day).
export function trackedSecondsToday(t: TimerSnapshot): number {
  if (isCountUpDay(t.dateKey)) return clamp(t.freeElapsedSeconds, 0, DAY_MAX_SECONDS);
  const goal = goalSecondsForDateKey(t.dateKey);
  return clamp(goal - t.remainingFocusSeconds, 0, goal);
}

// 1-based index of the focus block currently in progress (1 … blocks-of-the-day).
export function currentBlock(t: TimerSnapshot): number {
  const done = goalSecondsForDateKey(t.dateKey) - t.remainingFocusSeconds;
  return clamp(Math.floor(done / FOCUS_BLOCK_SECONDS) + 1, 1, blocksForDateKey(t.dateKey));
}

// Rebuild a live snapshot from the persisted server timer, so it can be
// projected forward to `now` on any device.
export function timerFromState(t: PersistedTimer): TimerSnapshot {
  return {
    phase: t.phase,
    running: t.running,
    remainingFocusSeconds: t.remainingFocusSeconds,
    blockElapsedSeconds: t.blockElapsedSeconds,
    breakElapsedSeconds: t.breakElapsedSeconds,
    lunchElapsedSeconds: t.lunchElapsedSeconds,
    freeElapsedSeconds: t.freeElapsedSeconds,
    underlyingPhase: t.underlyingPhase,
    anchorMs: t.anchorMs,
    dateKey: t.dateKey,
  };
}

// ---------------------------------------------------------------------------
// Persistence mapping / merging
// ---------------------------------------------------------------------------

export function defaultState(): TrackerState {
  return {
    days: {},
    timer: {
      phase: "idle",
      running: false,
      remainingFocusSeconds: FOCUS_GOAL_SECONDS,
      blockElapsedSeconds: 0,
      breakElapsedSeconds: 0,
      lunchElapsedSeconds: 0,
      freeElapsedSeconds: 0,
      underlyingPhase: "idle",
      anchorMs: 0,
      dateKey: "",
      lastUpdated: new Date(0).toISOString(),
    },
  };
}

// Defensive normalization of whatever JSON we read back from persistence.
export function normalizeState(input: unknown): TrackerState {
  const base = defaultState();
  if (!input || typeof input !== "object") return base;
  const obj = input as Partial<TrackerState>;

  const days: Record<string, DayRecord> = {};
  if (obj.days && typeof obj.days === "object") {
    for (const [key, value] of Object.entries(obj.days)) {
      const seconds = Number((value as DayRecord)?.focusSeconds);
      if (Number.isFinite(seconds)) {
        days[key] = { focusSeconds: clamp(seconds, 0, storeCapForDateKey(key)) };
      }
    }
  }

  const t = (obj.timer ?? {}) as Partial<PersistedTimer>;
  const phases: Phase[] = ["idle", "focus", "break", "lunch", "free"];
  const num = (v: unknown, fallback: number, min: number, max: number): number =>
    Number.isFinite(Number(v)) ? clamp(Number(v), min, max) : fallback;

  const dateKey = typeof t.dateKey === "string" ? t.dateKey : base.timer.dateKey;
  const goal = goalSecondsForDateKey(dateKey);

  return {
    days,
    timer: {
      phase: phases.includes(t.phase as Phase) ? (t.phase as Phase) : "idle",
      running: typeof t.running === "boolean" ? t.running : false,
      remainingFocusSeconds: num(t.remainingFocusSeconds, goal, 0, goal),
      blockElapsedSeconds: num(t.blockElapsedSeconds, 0, 0, FOCUS_BLOCK_SECONDS),
      breakElapsedSeconds: num(t.breakElapsedSeconds, 0, 0, BREAK_SECONDS),
      lunchElapsedSeconds: num(t.lunchElapsedSeconds, 0, 0, Number.MAX_SAFE_INTEGER),
      freeElapsedSeconds: num(t.freeElapsedSeconds, 0, 0, DAY_MAX_SECONDS),
      underlyingPhase: phases.includes(t.underlyingPhase as Phase)
        ? (t.underlyingPhase as Phase)
        : "idle",
      anchorMs: num(t.anchorMs, 0, 0, Number.MAX_SAFE_INTEGER),
      dateKey,
      lastUpdated: typeof t.lastUpdated === "string" ? t.lastUpdated : base.timer.lastUpdated,
    },
  };
}

// Server-side merge across devices: keep the higher focus per day (progress
// never regresses) and the timer with the newer `lastUpdated`, so a stale
// device can't clobber a fresher session.
export function mergeServerState(current: TrackerState, patch: TrackerState): TrackerState {
  const currentTime = Date.parse(current.timer.lastUpdated) || 0;
  const patchTime = Date.parse(patch.timer.lastUpdated) || 0;
  return {
    days: mergeDaysMax(current.days, patch.days),
    timer: patchTime >= currentTime ? patch.timer : current.timer,
  };
}

// Client-side hydrate merge: take the higher focus value per day so neither a
// freshly-fetched server value nor un-pushed local progress is lost.
export function mergeDaysMax(
  a: Record<string, DayRecord>,
  b: Record<string, DayRecord>,
): Record<string, DayRecord> {
  const out: Record<string, DayRecord> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const prev = out[key]?.focusSeconds ?? 0;
    out[key] = { focusSeconds: Math.max(prev, value.focusSeconds) };
  }
  return out;
}

// Build the persistable TrackerState from the live React state.
//
// `lastUpdatedMs` MUST be the time of the last *meaningful* change (a user
// action or an auto phase transition), NOT the push time. It drives the
// last-writer-wins merge across devices, so periodic checkpoints have to carry
// the original edit time — otherwise an idle background instance that merely
// re-pushes a stale snapshot every few seconds would out-timestamp (and thus
// clobber) a real, newer edit made on another device.
export function toTrackerState(
  days: Record<string, DayRecord>,
  timer: TimerSnapshot,
  lastUpdatedMs: number = Date.now(),
): TrackerState {
  const withToday = mergeDaysMax(days, {
    [timer.dateKey]: { focusSeconds: Math.round(trackedSecondsToday(timer)) },
  });
  return {
    days: withToday,
    timer: {
      phase: timer.phase,
      running: timer.running,
      remainingFocusSeconds: Math.round(timer.remainingFocusSeconds),
      blockElapsedSeconds: Math.round(timer.blockElapsedSeconds),
      breakElapsedSeconds: Math.round(timer.breakElapsedSeconds),
      lunchElapsedSeconds: Math.round(timer.lunchElapsedSeconds),
      freeElapsedSeconds: Math.round(timer.freeElapsedSeconds),
      underlyingPhase: timer.underlyingPhase,
      anchorMs: timer.anchorMs,
      dateKey: timer.dateKey,
      lastUpdated: new Date(lastUpdatedMs).toISOString(),
    },
  };
}
