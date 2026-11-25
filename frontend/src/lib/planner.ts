// Pure calendar/planner helpers. Everything is string based ("YYYY-MM-DD" and "YYYY-MM-DDTHH:mm" in the USER'S wall clock) and uses
// UTC arithmetic internally, so results never depend on the browser's time zone or DST. No React, no network.
export type View = 'day' | 'week' | 'month';
export const SNAP_MINUTES = 15;
const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');

export const isDateKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const toMs = (key: string) => Date.parse(`${key}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => fromMs(toMs(key) + n * DAY);
/** 0 = Sunday … 6 = Saturday (matches the backend's workDays). */
export const weekday = (key: string) => new Date(toMs(key)).getUTCDay();
export const diffDays = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);

/** Monday-based week start. */
export function weekStart(key: string): string { const wd = weekday(key); return addDays(key, -((wd + 6) % 7)); }
export const monthStart = (key: string) => `${key.slice(0, 7)}-01`;
export function monthEnd(key: string): string { const [y, m] = key.split('-').map(Number); return fromMs(Date.UTC(y, m, 0)); }
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number); const total = y * 12 + (m - 1) + n; const ny = Math.floor(total / 12); const nm = (total % 12) + 1;
  const last = Number(monthEnd(`${ny}-${pad(nm)}-01`).slice(8)); return `${ny}-${pad(nm)}-${pad(Math.min(Number(key.slice(8)), last))}`;
}

/** Inclusive date range the calendar must fetch for a view (month view includes the leading/trailing days it shows). */
export function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') { const s = weekStart(anchor); return { from: s, to: addDays(s, 6) }; }
  const s = weekStart(monthStart(anchor)); const e = addDays(weekStart(monthEnd(anchor)), 6); return { from: s, to: e };
}
export function daysIn(from: string, to: string): string[] { const out: string[] = []; for (let d = from; d <= to && out.length < 60; d = addDays(d, 1)) out.push(d); return out; }
export function step(view: View, anchor: string, dir: 1 | -1): string { return view === 'day' ? addDays(anchor, dir) : view === 'week' ? addDays(anchor, 7 * dir) : addMonths(anchor, dir); }

export const minutesOfDay = (wall: string) => Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
export const dateOf = (wall: string) => wall.slice(0, 10);
export function wallFrom(date: string, minutes: number): string { const m = Math.max(0, Math.min(1439, Math.round(minutes))); return `${date}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
export function shiftWall(wall: string, minutes: number): string { const ms = Date.parse(`${wall}:00Z`) + minutes * 60000; return new Date(ms).toISOString().slice(0, 16); }
export const minutesBetween = (a: string, b: string) => Math.round((Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60000);
export const snap = (minutes: number, by = SNAP_MINUTES) => Math.round(minutes / by) * by;

/** Pointer position inside a day column -> snapped wall-clock start. `grabOffsetMin` keeps the block under the cursor where it was grabbed. */
export function dropToStart(date: string, offsetY: number, pxPerMinute: number, gridStartMin: number, grabOffsetMin = 0, by = SNAP_MINUTES): string {
  const raw = gridStartMin + offsetY / pxPerMinute - grabOffsetMin;
  return wallFrom(date, Math.min(1439, Math.max(0, snap(raw, by))));
}

export interface Placed<T> { item: T; start: number; end: number; lane: number; lanes: number }
/** Side-by-side lanes for overlapping items in one day column (start/end in minutes since midnight). */
export function layoutLanes<T>(items: T[], span: (t: T) => { start: number; end: number }): Placed<T>[] {
  const sorted = items.map((item) => ({ item, ...span(item) })).sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = []; let group: Placed<T>[] = []; let groupEnd = -1; let laneEnds: number[] = [];
  const flush = () => { for (const p of group) p.lanes = laneEnds.length; out.push(...group); group = []; laneEnds = []; groupEnd = -1; };
  for (const s of sorted) {
    if (group.length && s.start >= groupEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= s.start); if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.end); } else laneEnds[lane] = s.end;
    group.push({ ...s, lane, lanes: 1 }); groupEnd = Math.max(groupEnd, s.end);
  }
  flush(); return out;
}

export function fmtTime(wall: string): string { const h = Number(wall.slice(11, 13)); const m = wall.slice(14, 16); return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`; }
export const fmtRange = (a: string, b: string) => `${fmtTime(a)} – ${fmtTime(b)}`;
export function fmtDuration(min: number): string { const h = Math.floor(min / 60); const m = min % 60; return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`; }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtDay = (key: string) => `${WEEKDAYS[weekday(key)]}, ${Number(key.slice(8))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
export function viewTitle(view: View, anchor: string): string {
  const mon = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
  if (view === 'day') return `${fmtDay(anchor)} ${anchor.slice(0, 4)}`;
  if (view === 'month') return mon(anchor);
  const { from, to } = rangeFor('week', anchor); return `${fmtDay(from)} – ${fmtDay(to)} ${to.slice(0, 4)}`;
}
/** Hour window the grid shows: the working window widened to include every item, clamped to a sane range. */
export function gridHours(working: { start: string; end: string } | null, extra: { start: string; end: string }[]): { startHour: number; endHour: number } {
  let s = working ? Number(working.start.slice(0, 2)) : 8; let e = working ? Math.ceil(Number(working.end.slice(0, 2)) + Number(working.end.slice(3, 5)) / 60) : 18;
  for (const x of extra) { s = Math.min(s, Math.floor(minutesOfDay(x.start) / 60)); const em = minutesOfDay(x.end) === 0 && dateOf(x.end) > dateOf(x.start) ? 1440 : minutesOfDay(x.end); e = Math.max(e, Math.ceil(em / 60)); }
  s = Math.max(0, s - 1); e = Math.min(24, e + 1); return { startHour: s, endHour: Math.max(e, s + 4) };
}
export const toLocalInput = (wall: string) => wall.slice(0, 16);
