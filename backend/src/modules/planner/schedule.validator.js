'use strict';
const { validateBody, validateQuery, validationError } = require('../../http/validate');

const rev = { type: 'int', min: 1, max: 1000000 };
const generate = (b) => validateBody(b ?? {}, { mode: { type: 'enum', values: ['minimal', 'fresh', 'clone'] }, useMl: { type: 'boolean' }, replace: { type: 'boolean' } });
const move = (b) => {
  const d = validateBody(b, { start: { type: 'datetime', required: true }, end: { type: 'datetime' }, revision: rev, preview: { type: 'boolean' } });
  return { ...d, start: d.start.replace(' ', 'T').slice(0, 16), ...(d.end ? { end: d.end.replace(' ', 'T').slice(0, 16) } : {}) };
};
const addBreak = (b) => {
  const d = validateBody(b, { start: { type: 'datetime', required: true }, end: { type: 'datetime', required: true }, revision: rev, replan: { type: 'boolean' } });
  const s = d.start.replace(' ', 'T').slice(0, 16); const e = d.end.replace(' ', 'T').slice(0, 16);
  if (!(e > s)) throw validationError([{ field: 'end', message: 'must be after the start time' }]);
  return { ...d, start: s, end: e };
};
const revisionQuery = (q) => validateQuery(q ?? {}, { revision: rev });
const revisionOnly = (b) => validateBody(b ?? {}, { revision: rev });
const postpone = (b) => validateBody(b ?? {}, { days: { type: 'int', min: 1, max: 30 }, reason: { type: 'string', maxLength: 200 }, confirm: { type: 'boolean' } });
const calendarQuery = (q) => {
  const d = validateQuery(q, { from: { type: 'date' }, to: { type: 'date' } });
  if (!d.from || !d.to) throw validationError([{ field: d.from ? 'to' : 'from', message: 'is required (YYYY-MM-DD)' }]);
  const days = (Date.parse(d.to) - Date.parse(d.from)) / 86400000;
  if (days < 0) throw validationError([{ field: 'to', message: 'must not be before from' }]);
  if (days > 42) throw validationError([{ field: 'to', message: 'the calendar range is limited to 43 days' }]);
  return d;
};
module.exports = { revisionQuery, generate, move, addBreak, revisionOnly, postpone, calendarQuery };
