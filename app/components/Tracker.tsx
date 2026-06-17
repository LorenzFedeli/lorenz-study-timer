"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DayGrid from "./DayGrid";
import {
  BREAK_SECONDS,
  defaultState,
  FOCUS_BLOCK_SECONDS,
  FOCUS_BLOCKS,
  FOCUS_GOAL_SECONDS,
  focusDoneToday,
  formatClock,
  formatHMS,
  freshTimer,
  isWeekend,
  mergeDaysMax,
  project,
  STORAGE_KEY,
  toTrackerState,
  todayKey,
  type DayRecord,
  type LocalCache,
  type TimerSnapshot,
  type TrackerState,
} from "@/app/lib/tracker";

const WEEKDAYS_DE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const TICK_MS = 500;
const SERVER_DEBOUNCE_MS = 2000;
const CHECKPOINT_MS = 30000;

const PHASE_BG: Record<string, string> = {
  focus: "var(--bg-focus)",
  idle: "var(--bg-focus)",
  break: "var(--bg-break)",
  lunch: "var(--bg-lunch)",
};

export default function Tracker() {
  const [mounted, setMounted] = useState(false);
  const [days, setDays] = useState<Record<string, DayRecord>>({});
  const [base, setBase] = useState<TimerSnapshot>(() => freshTimer(todayKey(), 0));
  const [nowMs, setNowMs] = useState(0);

  const baseRef = useRef(base);
  const daysRef = useRef(days);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    baseRef.current = base;
  }, [base]);
  useEffect(() => {
    daysRef.current = days;
  }, [days]);

  // Build the persistable state from the latest live values.
  const buildPersistState = useCallback((): TrackerState => {
    return toTrackerState(daysRef.current, project(baseRef.current, Date.now()));
  }, []);

  const pushServer = useCallback(() => {
    const body = JSON.stringify(buildPersistState());
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* offline / no token — localStorage keeps us going */
    });
  }, [buildPersistState]);

  const scheduleServerPush = useCallback(() => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(pushServer, SERVER_DEBOUNCE_MS);
  }, [pushServer]);

  const saveLocal = useCallback(() => {
    try {
      const cache: LocalCache = { days: daysRef.current, timer: baseRef.current };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      /* private mode / quota — ignore */
    }
  }, []);

  // ---- Mount: hydrate from localStorage, then reconcile with the server. ----
  useEffect(() => {
    let cancelled = false;

    // Run the synchronous init inside an async callback so it isn't a
    // synchronous setState in the effect body (avoids cascading-render lint).
    const hydrate = async () => {
      const now = Date.now();
      const today = todayKey();
      let initialDays: Record<string, DayRecord> = {};
      let initialBase = freshTimer(today, now);

      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const cache = JSON.parse(raw) as LocalCache;
          if (cache.days) initialDays = cache.days;
          if (cache.timer) {
            if (cache.timer.dateKey === today) {
              initialBase = project(cache.timer, now); // advance over the gap
            } else {
              // Cached timer belongs to a past day → bank it, start today fresh.
              initialDays = mergeDaysMax(initialDays, {
                [cache.timer.dateKey]: {
                  focusSeconds: Math.round(focusDoneToday(cache.timer)),
                },
              });
            }
          }
        }
      } catch {
        /* corrupt cache — ignore */
      }

      if (cancelled) return;
      setDays(initialDays);
      setBase(initialBase);
      setNowMs(now);
      setMounted(true);

      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const server: TrackerState = res.ok ? await res.json() : defaultState();
        if (cancelled) return;
        setDays((prev) => mergeDaysMax(prev, server.days ?? {}));
        setBase((prev) => {
          if (prev.dateKey !== today || prev.running || prev.phase !== "idle") {
            return prev; // active local session wins
          }
          const serverToday = server.days?.[today]?.focusSeconds ?? 0;
          if (serverToday > focusDoneToday(prev)) {
            const remaining = Math.max(0, FOCUS_GOAL_SECONDS - serverToday);
            return { ...prev, remainingFocusSeconds: remaining };
          }
          return prev;
        });
      } catch {
        /* server unreachable — localStorage already hydrated us */
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Clock tick: advance the display and commit phase / day transitions. ----
  useEffect(() => {
    if (!mounted) return;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);

      const prev = baseRef.current;
      const today = todayKey();
      if (prev.dateKey !== today) {
        // Midnight rollover: bank the finished day, start today fresh.
        setDays((d) =>
          mergeDaysMax(d, {
            [prev.dateKey]: { focusSeconds: Math.round(focusDoneToday(prev)) },
          }),
        );
        setBase(freshTimer(today, now));
        return;
      }
      const next = project(prev, now);
      if (next.phase !== prev.phase || next.running !== prev.running) {
        setBase(next); // commit a focus→break / break→focus / done transition
      }
    };
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [mounted]);

  // ---- Persist on any meaningful change (local immediately, server debounced) ----
  useEffect(() => {
    if (!mounted) return;
    saveLocal();
    scheduleServerPush();
  }, [days, base, mounted, saveLocal, scheduleServerPush]);

  // ---- Periodic server checkpoint while running ----
  useEffect(() => {
    if (!mounted) return;
    const id = setInterval(() => {
      if (baseRef.current.running) pushServer();
    }, CHECKPOINT_MS);
    return () => clearInterval(id);
  }, [mounted, pushServer]);

  // ---- Flush on tab hide / unload ----
  useEffect(() => {
    if (!mounted) return;
    const flush = () => {
      saveLocal();
      try {
        const blob = new Blob([JSON.stringify(buildPersistState())], {
          type: "application/json",
        });
        if (!navigator.sendBeacon("/api/state", blob)) pushServer();
      } catch {
        pushServer();
      }
    };
    const onVisibility = () => {
      if (document.hidden) flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mounted, saveLocal, pushServer, buildPersistState]);

  const live = useMemo(() => project(base, nowMs), [base, nowMs]);

  // -------------------------- Actions --------------------------

  // Single control. "Pause" === "Mittagspause": pressing it while the cycle
  // runs halts everything and counts the lunch break up; pressing it again
  // ("Weiter") resumes exactly where it left off.
  const onPrimary = useCallback(() => {
    setBase((prev) => {
      const s = project(prev, Date.now());
      const now = Date.now();
      if (s.phase === "lunch") {
        // Weiter → resume the underlying focus / break.
        const resume = s.underlyingPhase === "break" ? "break" : "focus";
        return { ...s, phase: resume, running: true, underlyingPhase: resume, lunchElapsedSeconds: 0, anchorMs: now };
      }
      if (s.running) {
        // Mittagspause → freeze the cycle, start counting lunch up.
        return { ...s, phase: "lunch", running: true, underlyingPhase: s.phase, lunchElapsedSeconds: 0, anchorMs: now };
      }
      if (s.phase === "idle") {
        if (s.remainingFocusSeconds <= 0) return s; // day done
        return { ...s, phase: "focus", running: true, blockElapsedSeconds: 0, breakElapsedSeconds: 0, underlyingPhase: "focus", anchorMs: now };
      }
      // Restored-from-cache paused focus / break → resume.
      return { ...s, running: true, anchorMs: now };
    });
  }, []);

  // -------------------------- Derived UI --------------------------

  const today = mounted ? new Date() : new Date(0);
  const isDone = live.phase === "idle" && live.remainingFocusSeconds <= 0;
  const todayFocus = focusDoneToday(live);

  // Progress split into the 4 focus blocks: done = full, current = partial,
  // future = empty.
  const blockFills = Array.from({ length: FOCUS_BLOCKS }, (_, i) =>
    Math.min(1, Math.max(0, (todayFocus - i * FOCUS_BLOCK_SECONDS) / FOCUS_BLOCK_SECONDS)),
  );

  // "pause" screen = the dark (#141414) break / lunch states; "focus" = black.
  // Per-screen greys mirror .screen--focus / .screen--pause from the spec.
  const gridVariant: "focus" | "pause" =
    live.phase === "break" || live.phase === "lunch" ? "pause" : "focus";
  const trackColor = gridVariant === "pause" ? "#2f2f32" : "#252528";
  const pillBg = gridVariant === "pause" ? "#2a2a2c" : "#1a1a1c";

  const phaseLabel = !mounted
    ? "—"
    : live.phase === "focus"
      ? "Fokus"
      : live.phase === "break"
        ? "Pause"
        : live.phase === "lunch"
          ? "Mittagspause"
          : isDone
            ? "Geschafft"
            : "Bereit";

  const blockLeft = Math.max(0, FOCUS_BLOCK_SECONDS - live.blockElapsedSeconds);
  const breakLeft = Math.max(0, BREAK_SECONDS - live.breakElapsedSeconds);
  const bg = mounted ? PHASE_BG[live.phase] : PHASE_BG.idle;

  const primaryLabel = !mounted
    ? "…"
    : live.phase === "lunch"
      ? "Weiter"
      : live.running
        ? "Mittagspause"
        : live.phase === "idle"
          ? "Start"
          : "Weiter";

  return (
    <div
      className="min-h-screen w-full transition-colors duration-700 ease-out"
      style={{ backgroundColor: bg }}
    >
      <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col gap-7 px-5 pb-10 pt-7 text-white">
        {/* Day tracker */}
        {mounted ? (
          <DayGrid days={days} todayFocusSeconds={todayFocus} now={today} variant={gridVariant} />
        ) : (
          <div className="w-full aspect-[6/5]" />
        )}

        {/* Main timer */}
        <section className="flex flex-col items-center gap-3 pt-2">
          {mounted ? (
            <span
              className="rounded-[20px] px-[14px] py-[5px] text-xs uppercase tracking-[2.5px] text-[#9a9aa0]"
              style={{ backgroundColor: pillBg }}
            >
              {phaseLabel}
            </span>
          ) : null}

          <div className="font-mono text-[clamp(40px,13vw,52px)] font-medium tracking-[1px] tabular-nums leading-none">
            {mounted ? formatHMS(live.remainingFocusSeconds) : "—:—:—"}
          </div>

          {/* Progress across the 4 focus blocks */}
          <div className="mt-1 flex w-full gap-[6px]">
            {blockFills.map((fill, i) => (
              <div
                key={i}
                className="h-[6px] flex-1 overflow-hidden rounded-[3px]"
                style={{ backgroundColor: trackColor }}
              >
                <div
                  className="h-full rounded-[3px] transition-[width] duration-500"
                  style={{ width: `${fill * 100}%`, backgroundColor: "#2faa5a" }}
                />
              </div>
            ))}
          </div>

          {/* Phase sub-status */}
          <div className="mt-1 min-h-[28px] text-center text-sm tabular-nums text-[#7c7c82]">
            {!mounted ? null : live.phase === "focus" ? (
              <span>
                noch{" "}
                <span className="font-mono tabular-nums">{formatClock(blockLeft)}</span> im Block
              </span>
            ) : live.phase === "break" ? (
              <span>
                Pause · noch{" "}
                <span className="font-mono tabular-nums">{formatClock(breakLeft)}</span>
              </span>
            ) : live.phase === "lunch" ? (
              <span>
                Mittagspause ·{" "}
                <span className="font-mono tabular-nums">
                  {formatClock(live.lunchElapsedSeconds)}
                </span>
              </span>
            ) : isDone ? (
              <span>6 h Fokuszeit erreicht 🎉</span>
            ) : (
              <span>
                {WEEKDAYS_DE[today.getDay()]}
                {isWeekend(today) ? " · kein Werktag" : " · bereit für 4 × 90 min"}
              </span>
            )}
          </div>
        </section>

        {/* Single control: Start → Mittagspause → Weiter */}
        <section>
          <button
            type="button"
            onClick={onPrimary}
            disabled={!mounted || isDone}
            className="w-full rounded-xl bg-[#1d1d20] p-[14px] text-[15px] font-medium text-[#ededed] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {primaryLabel}
          </button>
        </section>
      </main>
    </div>
  );
}
