'use strict';
// Wall-clock arithmetic for the scheduler. Everything is integer MINUTES on one absolute axis (minutes since 1970-01-01 00:00 of the
// user's LOCAL calendar). No time zone or DST rule is ever applied here: the caller supplies "now" as the user's local wall clock,
// and appointments/availability are stored as wall-clock values (same design as the session times sent to Python).
const { parseDateOnly, parseLocalDateTime } = require('../../utils/dates');

const DAY = 1440;
const pad = (n) => String(n).padStart(2, '0');

const dayNumberOf = (dateKey) => { const d = parseDateOnly(dateKey); if (!d) throw new RangeError(`invalid date "${dateKey}"`); return Math.round(d.getTime() / 86400000); };
const dateKeyOf = (dayNumber) => new Date(dayNumber * 86400000).toISOString().slice(0, 10);
const weekdayOf = (dayNumber) => (((dayNumber + 4) % 7) + 7) % 7; // 0 = Sunday (1970-01-01 was a Thursday)

/** "YYYY-MM-DDTHH:mm" | "YYYY-MM-DD HH:mm[:ss]" -> absolute minute. */
function toAbs(text) {
  const d = parseLocalDateTime(text);
  if (!d) throw new RangeError(`invalid wall-clock date-time "${text}"`);
  return Math.round(d.getTime() / 60000);
}
const fromAbs = (n) => { const day = Math.floor(n / DAY); const m = n - day * DAY; return `${dateKeyOf(day)}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const dayOf = (abs) => Math.floor(abs / DAY);

/** "HH:mm" (or "24:00") -> minute of day. */
function hhmm(text) {
  const m = /^(\d{2}):(\d{2})$/.exec(text ?? '');
  if (!m) throw new RangeError(`invalid time "${text}"`);
  const v = Number(m[1]) * 60 + Number(m[2]);
  if (Number(m[2]) > 59 || v > DAY) throw new RangeError(`invalid time "${text}"`);
  return v;
}
const ceilTo = (n, step) => Math.ceil(n / step) * step;

// ---- interval helpers: arrays of { start, end } (end exclusive) ----
function mergeIntervals(list) {
  const s = list.filter((i) => i.end > i.start).map((i) => ({ start: i.start, end: i.end })).sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const i of s) { const last = out[out.length - 1]; if (last && i.start <= last.end) last.end = Math.max(last.end, i.end); else out.push(i); }
  return out;
}
/** base minus cuts (both lists of intervals) -> sorted free pieces. */
function subtractIntervals(base, cuts) {
  const c = mergeIntervals(cuts); const out = [];
  for (const b of mergeIntervals(base)) {
    let cur = b.start;
    for (const x of c) {
      if (x.end <= cur) continue; if (x.start >= b.end) break;
      if (x.start > cur) out.push({ start: cur, end: x.start });
      cur = Math.max(cur, x.end);
    }
    if (cur < b.end) out.push({ start: cur, end: b.end });
  }
  return out;
}
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

module.exports = { DAY, dayNumberOf, dateKeyOf, weekdayOf, toAbs, fromAbs, dayOf, hhmm, ceilTo, mergeIntervals, subtractIntervals, overlaps };
