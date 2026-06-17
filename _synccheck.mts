import {
  normalizeState,
  timerFromState,
  project,
  toTrackerState,
  type TimerSnapshot,
} from "./app/lib/tracker";

const now0 = 1_000_000_000_000;

// Device 1: a running focus session, anchored at now0.
const device1: TimerSnapshot = {
  phase: "focus",
  running: true,
  remainingFocusSeconds: 5400,
  blockElapsedSeconds: 0,
  breakElapsedSeconds: 0,
  lunchElapsedSeconds: 0,
  underlyingPhase: "focus",
  anchorMs: now0,
  dateKey: "2026-06-17",
};

// Persist (as the server stores it), JSON round-trip, normalize (as the API does).
const persisted = toTrackerState({}, device1);
const overWire = normalizeState(JSON.parse(JSON.stringify(persisted)));

// Device 2: rebuild a live snapshot and project it 600s later than the anchor.
const adopted = timerFromState(overWire.timer);
const live = project(adopted, now0 + 600_000);

console.log("phase:", live.phase, "(expect focus)");
console.log("running:", live.running, "(expect true)");
console.log("remaining:", live.remainingFocusSeconds, "(expect 4800)");
console.log("blockElapsed:", live.blockElapsedSeconds, "(expect 600)");

// Lunch case: pause counts up across devices too.
const lunch: TimerSnapshot = { ...device1, phase: "lunch", underlyingPhase: "focus", lunchElapsedSeconds: 120 };
const lunchWire = normalizeState(JSON.parse(JSON.stringify(toTrackerState({}, lunch))));
const lunchLive = project(timerFromState(lunchWire.timer), now0 + 300_000);
console.log("lunchElapsed:", lunchLive.lunchElapsedSeconds, "(expect 420)");
