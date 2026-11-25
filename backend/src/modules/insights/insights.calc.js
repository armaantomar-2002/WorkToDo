'use strict';
// Pure aggregation helpers (no I/O) shared by the dashboard and insights services.
const { dayKeyInZone, addDays, formatLocalDateTime } = require('../../utils/dates');

const RANGES = Object.freeze([7, 30, 90]);
/** ["YYYY-MM-DD", ...] oldest -> newest, ending today (in the user's time zone). */
function dayRange(today, days) {
  return Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1)));
}
const round1 = (n) => Math.round(n * 10) / 10;
const rate = (part, whole) => (whole > 0 ? round1((part / whole) * 100) : 0);
const average = (values) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : 0);

/** Counts real instants per calendar day of `timeZone`; days outside `days` are ignored. */
function countByDay(instants, days, timeZone) {
  const counts = new Map(days.map((d) => [d, 0]));
  for (const at of instants) {
    const key = dayKeyInZone(at, timeZone);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  return counts;
}

function completionTrend({ days, completedAt, createdAt, timeZone }) {
  const done = countByDay(completedAt, days, timeZone);
  const made = countByDay(createdAt, days, timeZone);
  return days.map((date) => ({ date, completed: done.get(date), created: made.get(date) }));
}

/** sessions: [{ sessionDateTime: Date(wall-clock as UTC), availableTimeMinutes }] */
function sessionTrend({ days, sessions }) {
  const by = new Map(days.map((d) => [d, { date: d, sessions: 0, plannedMinutes: 0 }]));
  for (const s of sessions) {
    const bucket = by.get(formatLocalDateTime(s.sessionDateTime).slice(0, 10));
    if (bucket) { bucket.sessions += 1; bucket.plannedMinutes += s.availableTimeMinutes; }
  }
  return days.map((d) => by.get(d));
}

/** Fixed-order distribution including zero buckets, so charts always show every category. */
function distribution(order, values) {
  const counts = new Map(order.map((k) => [k, 0]));
  for (const v of values) if (counts.has(v)) counts.set(v, counts.get(v) + 1);
  return order.map((name) => ({ name, count: counts.get(name) }));
}

/** Finished timers -> per-day actual focused minutes / count, bucketed by the end instant in the user's time zone. */
function timerTrend({ days, timers, timeZone }) {
  const by = new Map(days.map((d) => [d, { date: d, focusedSeconds: 0, timers: 0 }]));
  for (const t of timers) {
    const b = by.get(dayKeyInZone(t.endedAt, timeZone));
    if (b) { b.focusedSeconds += t.actualFocusedSeconds; b.timers += 1; }
  }
  return days.map((d) => { const b = by.get(d); return { date: d, focusedMinutes: round1(b.focusedSeconds / 60), timers: b.timers }; });
}
module.exports = { timerTrend, RANGES, dayRange, rate, average, round1, countByDay, completionTrend, sessionTrend, distribution };
