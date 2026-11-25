'use strict';
const { validateBody, validateQuery, validationError, UUID_RE } = require('../../http/validate');
const { LEVEL, TIME_PERIOD } = require('../../constants/domain');

const SESSION_INLINE = {
  localTime: { type: 'datetime' }, availableTimeMinutes: { type: 'int', min: 1, max: 1440 }, longestFreeSlotMinutes: { type: 'int', min: 0, max: 1440 },
  currentTimePeriod: { type: 'enum', values: TIME_PERIOD }, energyLevel: { type: 'enum', values: LEVEL }, focusLevel: { type: 'enum', values: LEVEL },
};
const SPEC = { focusSessionId: { type: 'string', maxLength: 36 }, topK: { type: 'int', min: 1, max: 500 }, ...SESSION_INLINE };

/** Either a saved focusSessionId OR a complete inline session context (never both, never partial). */
function runInput(body) {
  const d = validateBody(body, SPEC);
  const inlineKeys = Object.keys(SESSION_INLINE);
  const errors = [];
  if (d.focusSessionId !== undefined) {
    if (!UUID_RE.test(d.focusSessionId)) errors.push({ field: 'focusSessionId', message: 'must be a valid id' });
    for (const k of inlineKeys) if (d[k] !== undefined) errors.push({ field: k, message: 'must not be sent together with focusSessionId' });
  } else {
    for (const k of inlineKeys) if (d[k] === undefined) errors.push({ field: k, message: 'is required (or send focusSessionId)' });
    if (!errors.length && d.longestFreeSlotMinutes > d.availableTimeMinutes) errors.push({ field: 'longestFreeSlotMinutes', message: 'must not exceed the available time' });
  }
  if (errors.length) throw validationError(errors);
  return d;
}
const historyQuery = (q) => {
  const d = validateQuery(q, { page: { type: 'int', min: 1, max: 100000 }, pageSize: { type: 'int', min: 1, max: 50 } });
  return { page: d.page ?? 1, pageSize: d.pageSize ?? 10 };
};
module.exports = { runInput, historyQuery };
