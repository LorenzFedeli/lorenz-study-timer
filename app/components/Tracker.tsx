"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import DayGrid from "./DayGrid";
import {
  blocksForDateKey,
  BREAK_SECONDS,
  defaultState,
  FOCUS_BLOCK_SECONDS,
  FOCUS_BLOCKS,
  formatClock,
  formatHMS,
  freshTimer,
  isCountUpDay,
  mergeDaysMax,
  project,
  STORAGE_KEY,
  timerFromState,
  toTrackerState,
  todayKey,
  trackedSecondsToday,
  type DayRecord,
  type LocalCache,
  type TimerSnapshot,
  type TrackerState,
} from "@/app/lib/tracker";

const WEEKDAYS_DE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const TICK_MS = 500;
const SERVER_DEBOUNCE_MS = 750;
const CHECKPOINT_MS = 10000;
const SERVER_POLL_MS = 5000;
const DAILY_QUOTES = [
  "Status: Loading Brain Cells... Bitte nicht den Stecker ziehen.",
  "Möge dein Kaffee stark und deine Kompilierfehler nicht existent sein.",
  "Koffein-Level: 95%. Motivations-Level: 404 - Not Found. Der Timer läuft trotzdem!",
  "Es ist kein Bug. Es ist ein Feature, das dich heute zum Lernen zwingt.",
  "Ctrl + Alt + Durchziehen. Jammern wird später implementiert.",
  "Es gibt 10 Arten von Menschen: Die, die Binärcode verstehen, und die, die Freizeit haben.",
  "Dein Gehirn hat gerade zu wenig RAM. Zeit für einen Fokus-Reboot!",
  "Fehler beim Kompilieren deines Wissens? Drücke nicht auf Abbrechen. Such den Bug!",
  "Mach dir keine Sorgen wegen Thermodynamik. Die Entropie gewinnt am Ende sowieso.",
  "Sei wie ein Proton: Immer positiv bleiben (auch wenn die Klausurphase negativ aussieht).",
  "Die Klausur ist wie Schrödingers Katze: Solange du nicht antrittst, hast du gleichzeitig bestanden und bist durchgefallen.",
  "Pi ist exakt 3. Zumindest für die nächsten 25 Minuten Fokus. Ruhig bleiben.",
  "Wenn Newton auf den Apfel gewartet hat, kannst du auch auf den Geistesblitz warten. Aber lies gefälligst das Skript dabei!",
  "Du bist kein Durchschnitt. Du bist das globale Maximum der Verteilung!",
  "Das Leben ist kein Ponyhof, sondern ein Labor. Und du bist heute der Chefwissenschaftler.",
  "Wenn es sich bewegt und es sollte nicht: Klebeband. Wenn es sich nicht bewegt und es sollte: Lernen.",
  "Ingenieure lösen Probleme, von denen du nicht wusstest, dass du sie hast, auf eine Weise, die du nicht verstehst. Fang an.",
  "Ein schlaues Pferd springt nur so hoch wie es muss. Ein Ingenieur baut eine Rampe.",
  "Zieh durch! Die Welt braucht Menschen, die wissen, warum die Brücke hält.",
  "Keine Ausreden. Die Raketenwissenschaft baut sich schließlich nicht von alleine.",
  "Einfach kann jeder. Deswegen sitzest du hier.",
  "Lernen ist wie das Kauen auf Glasscheiben - aber hey, das Gehalt später wird weich!",
  "Du lernst nicht für die Uni, du lernst für das High-End-Setup in deiner zukünftigen Bude.",
  "Nur noch 500 Seiten Skript, dann darfst du wieder schlafen.",
  "Lerne jetzt, weine später - und zwar beim Zählen deines Geldes im ersten Job.",
  "MINT-Studium: Wo \"Ich habe es verstanden\" bedeutet, dass man aufgehört hat zu fragen warum.",
  "45 Minuten Fokus bringen dich näher an den Abschluss als 45 Minuten TikTok.",
  "Fokus an. Welt aus. Kaffee rein.",
  "Auch der längste Algorithmus beginnt mit einer Zeile Code.",
  "Dein innerer Schweinehund ist auch nur ein Systemfehler.",
  "Nicht aufgeben. Cortana glaubt an dich (auch wenn es sonst niemand tut).",
  "Schweiß fließt, wenn Muskeln weinen. Kaffee fließt, wenn das Gehirn arbeitet.",
  "Konzentration ist die Fähigkeit, das Handy als Briefbeschwerer zu nutzen.",
  "Gestern ging nichts. Heute geht nichts. Kontinuität ist der Schlüssel!",
  "Kopf hoch! Irgendwo da draußen vergisst gerade ein Professor ein Semikolon.",
];

function quoteIndexForDateKey(dateKey: string): number {
  let hash = 0;
  for (const char of dateKey) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % DAILY_QUOTES.length;
}

export default function Tracker() {
  const [mounted, setMounted] = useState(false);
  const [days, setDays] = useState<Record<string, DayRecord>>({});
  const [base, setBase] = useState<TimerSnapshot>(() => freshTimer(todayKey(), 0));
  const [nowMs, setNowMs] = useState(0);

  const baseRef = useRef(base);
  const daysRef = useRef(days);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastServerTimerUpdate = useRef(0);
  const latestLocalTimerEdit = useRef(0);
  // Don't push to the server until the initial server reconcile has run, so a
  // stale pre-reconcile snapshot can't clobber a fresher cross-device session.
  const reconciled = useRef(false);

  useEffect(() => {
    baseRef.current = base;
  }, [base]);
  useEffect(() => {
    daysRef.current = days;
  }, [days]);

  // Build the persistable state from the latest live values. The persisted
  // `lastUpdated` is the time of the state we currently hold — either our own
  // last local edit or the timestamp of the remote edit we last adopted —
  // never the push time. This keeps periodic checkpoints from manufacturing a
  // newer timestamp that would clobber a fresher edit on another device.
  const buildPersistState = useCallback((): TrackerState => {
    const heldEditMs = Math.max(latestLocalTimerEdit.current, lastServerTimerUpdate.current);
    return toTrackerState(daysRef.current, project(baseRef.current, Date.now()), heldEditMs);
  }, []);

  const pushServer = useCallback(() => {
    if (!reconciled.current) return;
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
      const cache: LocalCache = {
        days: daysRef.current,
        timer: baseRef.current,
        updatedAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      /* private mode / quota — ignore */
    }
  }, []);

  const markLocalTimerEdit = useCallback((timeMs: number) => {
    latestLocalTimerEdit.current = Math.max(latestLocalTimerEdit.current, timeMs);
  }, []);

  const adoptServerState = useCallback((server: TrackerState, forceTimer = false): boolean => {
    setDays((prev) => mergeDaysMax(prev, server.days ?? {}));

    const today = todayKey();
    const serverTime = Date.parse(server.timer?.lastUpdated ?? "") || 0;
    const hasTodayTimer = server.timer?.dateKey === today && serverTime > 0;
    if (!hasTodayTimer) return false;
    const newestLocalOrServerTimer = Math.max(
      lastServerTimerUpdate.current,
      latestLocalTimerEdit.current,
    );
    if (!forceTimer && serverTime <= newestLocalOrServerTimer) return false;

    lastServerTimerUpdate.current = serverTime;
    setBase(project(timerFromState(server.timer), Date.now()));
    return true;
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
      let adoptedServer = false;

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
                  focusSeconds: Math.round(trackedSecondsToday(cache.timer)),
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

        // Global-source behavior: if the server has today's timer, it wins over
        // localStorage on page open. LocalStorage is only an offline/bootstrap
        // fallback, not a per-device authority.
        adoptedServer = adoptServerState(server, true);
      } catch {
        /* server unreachable — localStorage already hydrated us */
      } finally {
        // Reconcile done: server pushes are now safe, and we flush our
        // post-reconcile state so a local-newer session reaches the server.
        if (!cancelled) {
          reconciled.current = true;
          if (!adoptedServer) scheduleServerPush();
        }
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [adoptServerState, scheduleServerPush]);

  // ---- Clock tick: advance the display and commit phase / day transitions. ----
  useEffect(() => {
    if (!mounted) return;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);

      const prev = baseRef.current;
      const today = todayKey();
      if (prev.dateKey !== today) {
        // Midnight rollover: bank the finished day (projected so a running
        // timer's in-progress time counts), start today fresh.
        markLocalTimerEdit(now);
        const banked = Math.round(trackedSecondsToday(project(prev, now)));
        setDays((d) =>
          mergeDaysMax(d, { [prev.dateKey]: { focusSeconds: banked } }),
        );
        setBase(freshTimer(today, now));
        return;
      }
      const next = project(prev, now);
      if (next.phase !== prev.phase || next.running !== prev.running) {
        markLocalTimerEdit(now);
        setBase(next); // commit a focus→break / break→focus / done transition
      }
    };
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [markLocalTimerEdit, mounted]);

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

  // ---- Coarse global sync: pick up starts/pauses from other devices. ----
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;

    const pullServer = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const server: TrackerState = res.ok ? await res.json() : defaultState();
        if (!cancelled) adoptServerState(server);
      } catch {
        /* stay on the last local projection */
      }
    };

    const id = setInterval(pullServer, SERVER_POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) void pullServer();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [adoptServerState, mounted]);

  // ---- Flush on tab hide / unload ----
  useEffect(() => {
    if (!mounted) return;
    const flush = () => {
      saveLocal();
      if (!reconciled.current) return;
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
      const now = Date.now();
      const s = project(prev, now);
      if (isCountUpDay(s.dateKey)) {
        // Sunday rest day: a plain count-up stopwatch (start / pause / resume).
        markLocalTimerEdit(now);
        if (s.running && s.phase === "free") {
          return { ...s, running: false, anchorMs: now }; // pause, keep elapsed
        }
        return { ...s, phase: "free", running: true, anchorMs: now }; // start / resume
      }
      if (s.phase === "lunch") {
        // Weiter → resume the underlying focus / break.
        const resume = s.underlyingPhase === "break" ? "break" : "focus";
        markLocalTimerEdit(now);
        return { ...s, phase: resume, running: true, underlyingPhase: resume, lunchElapsedSeconds: 0, anchorMs: now };
      }
      if (s.running) {
        // Mittagspause → freeze the cycle, start counting lunch up.
        markLocalTimerEdit(now);
        return { ...s, phase: "lunch", running: true, underlyingPhase: s.phase, lunchElapsedSeconds: 0, anchorMs: now };
      }
      if (s.phase === "idle") {
        if (s.remainingFocusSeconds <= 0) return s; // day done
        markLocalTimerEdit(now);
        return { ...s, phase: "focus", running: true, blockElapsedSeconds: 0, breakElapsedSeconds: 0, underlyingPhase: "focus", anchorMs: now };
      }
      // Restored-from-cache paused focus / break → resume.
      markLocalTimerEdit(now);
      return { ...s, running: true, anchorMs: now };
    });
  }, [markLocalTimerEdit]);

  // -------------------------- Derived UI --------------------------

  const today = mounted ? new Date() : new Date(0);
  // Sunday is a count-up rest day (no goal); everything else counts a goal down.
  const countUp = mounted && isCountUpDay(live.dateKey);
  const isDone = !countUp && live.phase === "idle" && live.remainingFocusSeconds <= 0;
  const isLunch = live.phase === "lunch";
  const todayTracked = trackedSecondsToday(live);
  const dailyQuote = DAILY_QUOTES[quoteIndexForDateKey(live.dateKey || todayKey(today))];

  // Progress split into the day's focus blocks (4 weekdays, 2 Saturday; none on
  // Sunday). Pre-mount we render the weekday count so the server and first
  // client render agree (no hydration mismatch); the effect-driven re-render
  // then settles on the real count.
  const todayBlocks = mounted ? blocksForDateKey(live.dateKey || todayKey(today)) : FOCUS_BLOCKS;
  const blockFills = Array.from({ length: todayBlocks }, (_, i) =>
    Math.min(1, Math.max(0, (todayTracked - i * FOCUS_BLOCK_SECONDS) / FOCUS_BLOCK_SECONDS)),
  );

  // Phase → screen palette class. Drives every CSS custom property (bg, pill,
  // grid cells, track, fill, today-ring) for that screen.
  const screenClass = !mounted
    ? "s-black"
    : live.phase === "free"
      ? "s-rest"
      : live.phase === "break"
        ? "s-green"
        : live.phase === "lunch"
          ? "s-pause"
          : "s-black";

  const phaseLabel = !mounted
    ? "—"
    : countUp
      ? live.phase === "free"
        ? live.running
          ? "Freizeit"
          : "Pausiert"
        : "Ruhetag"
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

  // The big number: on Sunday it counts free time up; during a 5-min break it
  // counts the break down (m:ss); otherwise it's the focus total (frozen during
  // lunch).
  const bigTimer = !mounted
    ? "—:—:—"
    : countUp
      ? formatHMS(live.freeElapsedSeconds)
      : live.phase === "break"
        ? formatClock(breakLeft)
        : formatHMS(live.remainingFocusSeconds);

  const primaryLabel = !mounted
    ? "…"
    : countUp
      ? live.running
        ? "Pause"
        : live.phase === "free"
          ? "Weiter"
          : "Start"
      : live.phase === "lunch"
        ? "Weiter"
        : live.running
          ? "Mittagspause"
          : live.phase === "idle"
            ? "Start"
            : "Weiter";

  return (
    <div className={`screen min-h-[100dvh] w-full transition-colors duration-700 ease-out ${screenClass}`}>
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-[420px] flex-col gap-7 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[calc(1.25rem+env(safe-area-inset-left))] pr-[calc(1.25rem+env(safe-area-inset-right))] pt-[calc(1.75rem+env(safe-area-inset-top))] text-white landshort:max-w-none landshort:flex-row landshort:items-center landshort:justify-center landshort:gap-8 landshort:pb-[calc(0.5rem+env(safe-area-inset-bottom))] landshort:pt-[calc(0.5rem+env(safe-area-inset-top))]">
        {/* Day tracker */}
        {mounted ? (
          <DayGrid days={days} todayTrackedSeconds={todayTracked} now={today} />
        ) : (
          <div className="day-grid aspect-[7/6] w-full" style={{ "--rows": 6 } as CSSProperties} />
        )}

        {/* Timer + control. In landscape this is the hero pane beside the grid;
            in the portrait stack it's transparent (display:contents) so the
            sections keep flowing under the grid exactly as before. */}
        <div className="contents landshort:flex landshort:min-w-0 landshort:flex-1 landshort:flex-col landshort:items-center landshort:justify-center landshort:gap-6">
        {/* Main timer */}
        <section className="flex flex-col items-center gap-3 pt-2">
          {mounted ? (
            <span
              className="rounded-[20px] px-[13px] py-[5px] text-[11px] uppercase tracking-[2.5px]"
              style={{ backgroundColor: "var(--pill-bg)", color: "var(--pill-text)" }}
            >
              {phaseLabel}
            </span>
          ) : null}

          <div
            className={`font-mono text-[clamp(40px,13vw,52px)] font-medium tracking-[0.5px] tabular-nums leading-none text-white transition-opacity duration-300 landshort:text-[clamp(44px,7vw,64px)] ${isLunch ? "opacity-20" : "opacity-100"}`}
          >
            {bigTimer}
          </div>

          {/* Progress across the day's focus blocks — hidden on Sunday (no blocks) */}
          {!countUp ? (
            <div
              className={`mt-1 flex w-full gap-[6px] transition-opacity duration-300 ${isLunch ? "opacity-20" : "opacity-100"}`}
            >
              {blockFills.map((fill, i) => (
                <div
                  key={i}
                  className="h-[6px] flex-1 overflow-hidden rounded-[3px]"
                  style={{ backgroundColor: "var(--track)" }}
                >
                  <div
                    className="h-full rounded-[3px] transition-[width] duration-500"
                    style={{ width: `${fill * 100}%`, backgroundColor: "var(--segfill)" }}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {/* Phase sub-status */}
          <div
            className="mt-1 min-h-[17px] text-center text-[13px] tabular-nums"
            style={{ color: live.phase === "focus" || isLunch ? "#ffffff" : "var(--sub)" }}
          >
            {!mounted ? null : countUp ? (
              <span>
                {WEEKDAYS_DE[today.getDay()]}
                {live.phase === "free" ? " · freie Zeit" : " · Ruhetag"}
              </span>
            ) : live.phase === "focus" ? (
              <span>
                noch{" "}
                <span className="font-mono tabular-nums">{formatClock(blockLeft)}</span> im Block
              </span>
            ) : live.phase === "break" ? null : live.phase === "lunch" ? (
              <span>
                Mittagspause ·{" "}
                <span className="font-mono tabular-nums">
                  {formatClock(live.lunchElapsedSeconds)}
                </span>
              </span>
            ) : isDone ? (
              <span>Tagesziel erreicht</span>
            ) : (
              <span>
                {WEEKDAYS_DE[today.getDay()]}
                {` · bereit für ${todayBlocks} × 90 min`}
              </span>
            )}
          </div>
        </section>

        {/* Single control: Start → Mittagspause → Weiter */}
        <section className="landshort:w-[240px]">
          <button
            type="button"
            onClick={onPrimary}
            disabled={!mounted || isDone}
            className="w-full rounded-xl p-[14px] text-[14px] font-medium transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: "var(--btn-bg)", color: "var(--btn-text)" }}
          >
            {primaryLabel}
          </button>
        </section>
        </div>{/* /hero pane */}

        <footer className="mt-auto text-center text-[11px] leading-[1.45] text-white/55 landshort:hidden">
          {dailyQuote}
        </footer>
      </main>
    </div>
  );
}
