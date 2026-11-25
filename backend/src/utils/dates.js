'use strict';
// The ONLY place where wall-clock strings and JS Dates are converted.
//  - Task dates are DATE columns: read/written as UTC-midnight Dates and exposed as "YYYY-MM-DD".
//  - Session wall-clock times are TIMESTAMP(0) (no zone): the string is stored as-is by labelling it UTC, and read back
//    from the UTC fields, so no timezone or DST rule is ever applied. API format: "YYYY-MM-DD HH:mm:ss".
//  - Audit instants (createdAt...) are real instants (TIMESTAMPTZ) and are exposed as ISO-8601 strings.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const validYmd = (y, m, d) => y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);

/** "YYYY-MM-DD" -> Date at UTC midnight, or null when malformed / not a real calendar date. */
function parseDateOnly(text) {
  const m = typeof text === 'string' ? DATE_RE.exec(text) : null;
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  return validYmd(y, mo, d) ? new Date(Date.UTC(y, mo - 1, d)) : null;
}
function formatDateOnly(date) {
  if (!date) return null;
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** "YYYY-MM-DD HH:mm[:ss]" (or with "T") -> Date whose UTC fields carry the wall-clock value; null when invalid. */
function parseLocalDateTime(text) {
  const m = typeof text === 'string' ? DATETIME_RE.exec(text) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
  if (!validYmd(y, mo, d) || h > 23 || mi > 59 || s > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}
function formatLocalDateTime(date) {
  if (!date) return null;
  return `${formatDateOnly(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/** Calendar day ("YYYY-MM-DD") of a real instant in an IANA time zone. Falls back to UTC for an unknown zone. */
function dayKeyInZone(instant, timeZone = 'UTC') {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  } catch {
    return formatDateOnly(instant);
  }
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
/** Adds whole days to a "YYYY-MM-DD" string (pure calendar arithmetic). */
function addDays(ymd, days) {
  const d = parseDateOnly(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateOnly(d);
}
const toIso = (date) => (date ? date.toISOString() : null);

module.exports = { parseDateOnly, formatDateOnly, parseLocalDateTime, formatLocalDateTime, dayKeyInZone, isValidTimeZone, addDays, toIso };
