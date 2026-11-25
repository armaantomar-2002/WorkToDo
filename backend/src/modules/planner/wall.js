'use strict';
// Wall-clock helpers. DB TIMESTAMP(0) columns hold the user's LOCAL wall clock (labelled UTC by Prisma, see utils/dates.js);
// the scheduler works on "YYYY-MM-DDTHH:mm" strings. No zone/DST rule is applied to stored values.
const { parseLocalDateTime, formatLocalDateTime, formatDateOnly, parseDateOnly, addDays } = require('../../utils/dates');

const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
const toWall = (date) => (date ? formatLocalDateTime(date).slice(0, 16).replace(' ', 'T') : null);
const fromWall = (text) => { const d = parseLocalDateTime(text); if (!d) throw new RangeError(`invalid wall-clock value "${text}"`); return d; };
const dateOnly = (key) => (key ? parseDateOnly(key) : null);

const safeZone = (tz) => { try { if (tz) { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } } catch { /* fall through */ } return DEFAULT_TIME_ZONE; };

/** The user's current local wall clock as "YYYY-MM-DDTHH:mm" in an IANA zone. Works for any valid zone; DST gaps/overlaps are not modelled by the planner. */
function nowWall(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: safeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}
const periodOfHour = (h) => (h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : h >= 17 && h < 21 ? 'Evening' : 'Night');

module.exports = { DEFAULT_TIME_ZONE, toWall, fromWall, dateOnly, safeZone, nowWall, periodOfHour, formatDateOnly, parseDateOnly, addDays };
