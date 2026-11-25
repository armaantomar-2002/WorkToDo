'use strict';
const { toIso } = require('../../utils/dates');

/** Public user shape: never includes passwordHash or anything token-related. */
const toPublicUser = (u) => ({ id: u.id, fullName: u.fullName, email: u.email, isEmailVerified: u.isEmailVerified, createdAt: toIso(u.createdAt) });
/** "1,2,3" -> [1,2,3] (0 = Sunday). Falls back to Mon-Fri for missing/garbled values. */
const parseWorkDays = (v) => { const a = typeof v === 'string' ? v.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : []; return a.length ? [...new Set(a)].sort() : [1, 2, 3, 4, 5]; };
const toPublicPreferences = (p) => ({
  defaultEnergyLevel: p.defaultEnergyLevel, defaultFocusLevel: p.defaultFocusLevel, preferredTimePeriod: p.preferredTimePeriod,
  themePreference: p.themePreference, notificationPreference: p.notificationPreference, timeZone: p.timeZone,
  workDayStart: p.workDayStart ?? '09:00', workDayEnd: p.workDayEnd ?? '18:00', workDays: parseWorkDays(p.workDays),
  breaksEnabled: p.breaksEnabled ?? true, breakMinutes: p.breakMinutes ?? 10, breakAfterMinutes: p.breakAfterMinutes ?? 90, planningHorizonDays: p.planningHorizonDays ?? 7,
});
module.exports = { toPublicUser, toPublicPreferences, parseWorkDays };
