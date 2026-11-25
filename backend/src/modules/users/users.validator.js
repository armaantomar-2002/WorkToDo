'use strict';
const { validateBody, validationError } = require('../../http/validate');
const { LEVEL, TIME_PERIOD, THEME, NOTIFICATION } = require('../../constants/domain');

const profileInput = (b) => validateBody(b, {
  fullName: { type: 'string', minLength: 1, maxLength: 120 }, email: { type: 'email' }, currentPassword: { type: 'string', trim: false, minLength: 1, maxLength: 128 },
}, { partial: true });
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const preferencesInput = (b) => {
  const body = { ...(b && typeof b === 'object' ? b : {}) };
  const planner = {}; const errors = [];
  for (const k of ['workDayStart', 'workDayEnd', 'workDays']) if (k in body) { planner[k] = body[k]; delete body[k]; }
  const d = validateBody(body, {
    defaultEnergyLevel: { type: 'enum', values: LEVEL }, defaultFocusLevel: { type: 'enum', values: LEVEL }, preferredTimePeriod: { type: 'enum', values: TIME_PERIOD },
    themePreference: { type: 'enum', values: THEME }, notificationPreference: { type: 'enum', values: NOTIFICATION }, timeZone: { type: 'timezone' },
    breaksEnabled: { type: 'boolean' }, breakMinutes: { type: 'int', min: 1, max: 120 }, breakAfterMinutes: { type: 'int', min: 30, max: 480 }, planningHorizonDays: { type: 'int', min: 1, max: 30 },
  }, { partial: true });
  if ('workDayStart' in planner) { if (typeof planner.workDayStart === 'string' && HHMM.test(planner.workDayStart)) d.workDayStart = planner.workDayStart; else errors.push({ field: 'workDayStart', message: 'must be a time like 09:00' }); }
  if ('workDayEnd' in planner) { if (typeof planner.workDayEnd === 'string' && (HHMM.test(planner.workDayEnd) || planner.workDayEnd === '24:00')) d.workDayEnd = planner.workDayEnd; else errors.push({ field: 'workDayEnd', message: 'must be a time like 18:00' }); }
  if ('workDays' in planner) {
    const a = planner.workDays;
    if (Array.isArray(a) && a.length >= 1 && a.length <= 7 && a.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) && new Set(a).size === a.length) d.workDays = [...a].sort().join(',');
    else errors.push({ field: 'workDays', message: 'must be 1-7 distinct weekday numbers (0 = Sunday ... 6 = Saturday)' });
  }
  if (errors.length) throw validationError(errors);
  return d;
};
module.exports = { profileInput, preferencesInput };
