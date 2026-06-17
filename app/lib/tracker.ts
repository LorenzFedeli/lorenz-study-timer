// Pure, isomorphic tracker logic shared by client UI and server route handlers.
// No React, no Blob, no browser/server-only APIs in here.

export const FOCUS_GOAL_SECONDS = 6 * 60 * 60; // 6 h focus goal per weekday
export const FOCUS_BLOCK_SECONDS = 90 * 60; // 90 min focus block
export const BREAK_SECONDS = 5 * 60; // 5 min break between blocks
export const FOCUS_BLOCKS = FOCUS_GOAL_SECONDS / FOCUS_BLOCK_SECONDS; // = 4
export const GRID_WEEKS = 6;

export type Phase = "idle" | "focus" | "break" | "lunch";

// Rich runtime snapshot. The values are correct as of `anchorMs`; while
// `running` is true they are extrapolated forward with `project()`.
export interface TimerSnapshot {
  phase: Phase;
  running: boolean;
  remainingFocusSeconds: number; // remaining focus toward the 6 h goal
  blockElapsedSeconds: number; // focus seconds done inside the current 90-min block
  breakElapsedSeconds: number; // seconds into the current 5-min break
  lunchElapsedSeconds: number; // seconds into the current lunch break
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

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
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
// the 5 weekdays Mon–Fri.
export function buildGrid(now: Date = new Date()): Date[][] {
  const thisMonday = mondayOf(now);
  const weeks: Date[][] = [];
  for (let w = 0; w < GRID_WEEKS; w++) {
    const weekMonday = addDays(thisMonday, 7 * w);
    const days: Date[] = [];
    for (let d = 0; d < 5; d++) days.push(addDays(weekMonday, d));
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
    remainingFocusSeconds: FOCUS_GOAL_SECONDS,
    blockElapsedSeconds: 0,
    breakElapsedSeconds: 0,
    lunchElapsedSeconds: 0,
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

// Focus seconds completed today (0 … 6 h), derived from the live snapshot.
export function focusDoneToday(t: TimerSnapshot): number {
  return clamp(FOCUS_GOAL_SECONDS - t.remainingFocusSeconds, 0, FOCUS_GOAL_SECONDS);
}

// 1-based index of the focus block currently in progress (1 … 4).
export function currentBlock(t: TimerSnapshot): number {
  const done = FOCUS_GOAL_SECONDS - t.remainingFocusSeconds;
  return clamp(Math.floor(done / FOCUS_BLOCK_SECONDS) + 1, 1, FOCUS_BLOCKS);
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
        days[key] = { focusSeconds: clamp(seconds, 0, FOCUS_GOAL_SECONDS) };
      }
    }
  }

  const t = (obj.timer ?? {}) as Partial<PersistedTimer>;
  const phases: Phase[] = ["idle", "focus", "break", "lunch"];
  const num = (v: unknown, fallback: number, min: number, max: number): number =>
    Number.isFinite(Number(v)) ? clamp(Number(v), min, max) : fallback;

  return {
    days,
    timer: {
      phase: phases.includes(t.phase as Phase) ? (t.phase as Phase) : "idle",
      running: typeof t.running === "boolean" ? t.running : false,
      remainingFocusSeconds: num(t.remainingFocusSeconds, FOCUS_GOAL_SECONDS, 0, FOCUS_GOAL_SECONDS),
      blockElapsedSeconds: num(t.blockElapsedSeconds, 0, 0, FOCUS_BLOCK_SECONDS),
      breakElapsedSeconds: num(t.breakElapsedSeconds, 0, 0, BREAK_SECONDS),
      lunchElapsedSeconds: num(t.lunchElapsedSeconds, 0, 0, Number.MAX_SAFE_INTEGER),
      underlyingPhase: phases.includes(t.underlyingPhase as Phase)
        ? (t.underlyingPhase as Phase)
        : "idle",
      anchorMs: num(t.anchorMs, 0, 0, Number.MAX_SAFE_INTEGER),
      dateKey: typeof t.dateKey === "string" ? t.dateKey : base.timer.dateKey,
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
export function toTrackerState(
  days: Record<string, DayRecord>,
  timer: TimerSnapshot,
): TrackerState {
  const withToday = mergeDaysMax(days, {
    [timer.dateKey]: { focusSeconds: Math.round(focusDoneToday(timer)) },
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
      underlyingPhase: timer.underlyingPhase,
      anchorMs: timer.anchorMs,
      dateKey: timer.dateKey,
      lastUpdated: new Date().toISOString(),
    },
  };
}
