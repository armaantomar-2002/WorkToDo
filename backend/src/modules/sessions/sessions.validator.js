'use strict';
const { validateBody, validateQuery, validationError } = require('../../http/validate');
const { LEVEL, TIME_PERIOD } = require('../../constants/domain');

const SESSION_SPEC = {
  sessionDateTime: { type: 'datetime', required: true },
  availableTimeMinutes: { type: 'int', min: 1, max: 1440, required: true },
  longestFreeSlotMinutes: { type: 'int', min: 0, max: 1440, required: true },
  currentTimePeriod: { type: 'enum', values: TIME_PERIOD, required: true },
  energyLevel: { type: 'enum', values: LEVEL, required: true },
  focusLevel: { type: 'enum', values: LEVEL, required: true },
};
const crossErrors = (s) => (s.longestFreeSlotMinutes > s.availableTimeMinutes ? [{ field: 'longestFreeSlotMinutes', message: 'must not exceed the available time' }] : []);

function createInput(body) {
  const data = validateBody(body, SESSION_SPEC);
  const errors = crossErrors(data);
  if (errors.length) throw validationError(errors);
  return data;
}
function updateInput(body, existing) {
  const patch = validateBody(body, SESSION_SPEC, { partial: true });
  if (Object.keys(patch).length === 0) throw validationError([{ field: 'body', message: 'must contain at least one field to update' }]);
  const errors = crossErrors({ ...existing, ...patch });
  if (errors.length) throw validationError(errors);
  return patch;
}
const listQuery = (q) => {
  const d = validateQuery(q, { page: { type: 'int', min: 1, max: 100000 }, pageSize: { type: 'int', min: 1, max: 100 }, from: { type: 'date' }, to: { type: 'date' } });
  return { page: d.page ?? 1, pageSize: d.pageSize ?? 10, from: d.from, to: d.to };
};
module.exports = { createInput, updateInput, listQuery, SESSION_SPEC };
