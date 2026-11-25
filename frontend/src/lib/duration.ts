/** Hours + minutes <-> total minutes. The API and the ML contract always use total minutes. */
export const MAX_DURATION_MINUTES = 10080; // one week, same cap as the backend

export const DURATION_PRESETS: { label: string; minutes: number }[] = [
  { label: '15 min', minutes: 15 }, { label: '30 min', minutes: 30 }, { label: '45 min', minutes: 45 },
  { label: '1 hour', minutes: 60 }, { label: '1 hr 30 min', minutes: 90 }, { label: '2 hours', minutes: 120 }, { label: '3 hours', minutes: 180 },
];

export function splitMinutes(total: number | null | undefined): { hours: number; minutes: number } | null {
  if (total == null || !Number.isFinite(total) || total < 0) return null;
  const t = Math.floor(total);
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}

export interface ParsedDuration { total: number | null; error: string | null }

/** Parses the two text boxes. Empty boxes = no value (not an error here; required-ness is the form's job). */
export function parseDuration(hoursText: string, minutesText: string): ParsedDuration {
  const h = hoursText.trim(); const m = minutesText.trim();
  if (h === '' && m === '') return { total: null, error: null };
  const num = (s: string) => (s === '' ? 0 : /^-?\d+$/.test(s) ? Number(s) : NaN);
  const hours = num(h); const minutes = num(m);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return { total: null, error: 'Use whole numbers' };
  if (hours < 0) return { total: null, error: 'Hours cannot be negative' };
  if (minutes < 0 || minutes > 59) return { total: null, error: 'Minutes must be between 0 and 59' };
  const total = hours * 60 + minutes;
  if (total <= 0) return { total: null, error: 'Duration must be greater than zero' };
  if (total > MAX_DURATION_MINUTES) return { total: null, error: 'Must be at most 7 days (168 hours)' };
  return { total, error: null };
}

/** 30 -> "30 minutes", 60 -> "1 hour", 90 -> "1 hour 30 minutes", 195 -> "3 hours 15 minutes". */
export function describeMinutes(total: number | null | undefined): string {
  const s = splitMinutes(total);
  if (!s || (s.hours === 0 && s.minutes === 0)) return '';
  const parts: string[] = [];
  if (s.hours) parts.push(`${s.hours} ${s.hours === 1 ? 'hour' : 'hours'}`);
  if (s.minutes) parts.push(`${s.minutes} ${s.minutes === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}
