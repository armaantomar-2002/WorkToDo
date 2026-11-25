'use strict';
const { validateBody, validateQuery, validationError } = require('../../http/validate');
const D = require('../../constants/domain');
const { parseLocalDateTime } = require('../../utils/dates');

const SPEC = {
  title: { type: 'string', required: true, minLength: 1, maxLength: 200 }, description: { type: 'string', nullable: true, maxLength: 2000 }, location: { type: 'string', nullable: true, maxLength: 200 },
  startAt: { type: 'datetime', required: true }, endAt: { type: 'datetime', required: true },
  preparationBufferMinutes: { type: 'int', min: 0, max: 480 }, travelBufferMinutes: { type: 'int', min: 0, max: 480 },
  importance: { type: 'enum', values: D.IMPORTANCE }, consequenceOfDelay: { type: 'enum', values: D.CONSEQUENCE_OF_DELAY },
};
const minutesBetween = (a, b) => (parseLocalDateTime(b) - parseLocalDateTime(a)) / 60000;
const checkOrder = (d) => {
  const m = minutesBetween(d.startAt, d.endAt);
  if (!(m > 0)) throw validationError([{ field: 'endAt', message: 'must be after the start time' }]);
  if (m > 1440) throw validationError([{ field: 'endAt', message: 'an appointment cannot be longer than 24 hours' }]);
  return d;
};
const create = (b) => checkOrder({ description: null, location: null, preparationBufferMinutes: 0, travelBufferMinutes: 0, importance: 'Medium', consequenceOfDelay: 'Moderate', ...validateBody(b, SPEC) });
const update = (b) => {
  const d = validateBody(b, { ...SPEC, title: { ...SPEC.title, required: false }, startAt: { type: 'datetime' }, endAt: { type: 'datetime' }, revision: { type: 'int', min: 1, max: 1000000 } }, { partial: true });
  if (!Object.keys(d).length) throw validationError([{ field: 'body', message: 'must contain at least one field to update' }]);
  return d;
};
const cancel = (b) => validateBody(b ?? {}, { reason: { type: 'string', maxLength: 300 } });
const range = (q) => {
  const d = validateQuery(q, { from: { type: 'date' }, to: { type: 'date' }, status: { type: 'enum', values: ['scheduled', 'cancelled'] } });
  if (d.from && d.to && d.to < d.from) throw validationError([{ field: 'to', message: 'must not be before from' }]);
  return d;
};
const unavailable = (b) => {
  const d = validateBody(b, { label: { type: 'string', minLength: 1, maxLength: 100 }, startAt: { type: 'datetime', required: true }, endAt: { type: 'datetime', required: true } });
  const m = minutesBetween(d.startAt, d.endAt);
  if (!(m > 0)) throw validationError([{ field: 'endAt', message: 'must be after the start time' }]);
  if (m > 31 * 1440) throw validationError([{ field: 'endAt', message: 'an unavailable period cannot be longer than 31 days' }]);
  return { label: d.label ?? 'Unavailable', startAt: d.startAt, endAt: d.endAt };
};
module.exports = { create, update, cancel, range, unavailable, minutesBetween };
