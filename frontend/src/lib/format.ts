import type { TimePeriod } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-16" -> "Nov 16, 2026". Pure string handling: no Date parsing, so no timezone can shift the day. */
export function formatDate(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
/** "2026-11-16 10:00:00" -> "Nov 16, 2026, 10:00 AM" (wall-clock time, no timezone conversion). */
export function formatDateTime(local: string | null | undefined): string {
  if (!local) return '—';
  const [date, time = '00:00'] = local.replace('T', ' ').split(' ');
  const [h, mi] = time.split(':').map(Number);
  return `${formatDate(date)}, ${h % 12 === 0 ? 12 : h % 12}:${pad(mi)} ${h < 12 ? 'AM' : 'PM'}`;
}
/** ISO instant -> local, human readable (used only for audit timestamps such as "generated at"). */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${d.getHours() % 12 === 0 ? 12 : d.getHours() % 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}
export function formatLongDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow}, ${MONTHS[m - 1]} ${d}, ${y}`;
}
export const shortDay = (ymd: string) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;

export function formatMinutes(mins: number | null | undefined): string {
  if (mins === null || mins === undefined) return '—';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60); const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** Whole days between two "YYYY-MM-DD" strings (b - a), by calendar arithmetic only. */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
export function dueLabel(due: string | null, today: string): string {
  if (!due) return 'No deadline';
  const n = daysBetween(today, due);
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due in 1 day';
  if (n > 1) return `Due in ${n} days`;
  return n === -1 ? 'Overdue by 1 day' : `Overdue by ${-n} days`;
}

/** Browser-local "now" in the backend's wall-clock format. */
export function nowLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}
export function todayLocal(): string { return nowLocal().slice(0, 10); }
/** Suggested (editable) time period for an hour of the day; scoring is never done here. */
export function periodForHour(h: number): TimePeriod { return h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : h >= 17 && h < 21 ? 'Evening' : 'Night'; }
/** <input type="datetime-local"> value <-> API wall-clock string. */
export const toInputDateTime = (local: string) => local.replace(' ', 'T').slice(0, 16);
export const fromInputDateTime = (v: string) => `${v.replace('T', ' ')}${v.length === 16 ? ':00' : ''}`;
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
export const greeting = (h: number) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
export const pct = (n: number) => `${Math.round(n)}%`;
