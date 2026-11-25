'use strict';
const { AppError } = require('../errors/AppError');
const { SESSION_FIELDS, TASK_FIELDS } = require('../mappers/fields');

// Gateway validation: structure, whitelist, JSON types and local date/time syntax only. Allowed values and domain rules
// (categories, ranges, splittable minimums, duplicates...) stay with the Python engine, which remains the authority.

const MAX_TASKS_PER_REQUEST = 500;
const MAX_ERRORS = 50;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/; // HH:mm or HH:mm:ss; fractional seconds are not part of the contract
const HAS_OFFSET = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

const SESSION_SPEC = {
  localTime: { required: true, type: 'localTime' }, availableTimeMinutes: { required: true, type: 'number' }, longestFreeSlotMinutes: { required: true, type: 'number' },
  currentTimePeriod: { required: true, type: 'string' }, energyLevel: { required: true, type: 'string' }, focusLevel: { required: true, type: 'string' },
};
const TASK_SPEC = {
  taskId: { required: true, type: 'id' }, taskName: { type: 'string', nullable: true }, startDate: { type: 'date', nullable: true }, dueDate: { type: 'date', nullable: true },
  importance: { required: true, type: 'string' }, goalContribution: { required: true, type: 'string' }, consequenceOfDelay: { required: true, type: 'string' },
  complexity: { required: true, type: 'string' }, estimatedDurationMinutes: { required: true, type: 'number' }, minimumSessionMinutes: { type: 'number', nullable: true },
  isSplittable: { required: true, type: 'boolean' }, preferredTime: { required: true, type: 'string' }, dependencyStatus: { type: 'string', nullable: true },
  status: { required: true, type: 'string' },
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

function validCalendar(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m); }

/**
 * Checks local date/time syntax with plain arithmetic (no Date objects, so nothing is ever interpreted as UTC or shifted by
 * a timezone/DST rule). Returns an error message or null. Offsets ("Z", "+05:30") are rejected.
 */
function localDateTimeProblem(value, { allowDateOnly }) {
  if (typeof value !== 'string') return 'must be a string';
  if (HAS_OFFSET.test(value)) return 'must be a local date/time without a timezone offset (no "Z" or ±hh:mm)';
  const shape = allowDateOnly ? 'a local date ("YYYY-MM-DD") or date-time ("YYYY-MM-DD HH:mm[:ss]")' : 'a local date-time like "YYYY-MM-DD HH:mm:ss"';
  const dateTime = LOCAL_DATE_TIME.exec(value);
  if (dateTime) {
    const [y, mo, d, h, mi, s] = dateTime.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
    return validCalendar(y, mo, d) && h < 24 && mi < 60 && s < 60 ? null : 'must be a valid local date and time';
  }
  const dateOnly = allowDateOnly ? LOCAL_DATE.exec(value) : null;
  if (dateOnly) { const [y, mo, d] = dateOnly.slice(1).map(Number); return validCalendar(y, mo, d) ? null : 'must be a valid calendar date'; }
  return `must be ${shape}`;
}

function typeProblem(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string' ? null : 'must be a string';
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number';
    case 'boolean': return typeof value === 'boolean' ? null : 'must be true or false';
    case 'id': return (typeof value === 'string' && value.trim() !== '') || Number.isSafeInteger(value) ? null : 'must be a non-empty string or a safe integer';
    case 'localTime': return localDateTimeProblem(value, { allowDateOnly: false });
    case 'date': return localDateTimeProblem(value, { allowDateOnly: true });
    default: return 'has an unsupported type';
  }
}

function validateObject(source, spec, path, errors) {
  const out = {};
  const label = (key) => (path ? `${path}.${key}` : key);
  const push = (field, message) => { if (errors.length < MAX_ERRORS) errors.push({ field, message }); };
  if (!isPlainObject(source)) { push(path, 'must be an object'); return out; }
  for (const key of Object.keys(source)) if (!Object.hasOwn(spec, key)) push(label(String(key).slice(0, 60)), 'unknown property');
  for (const [key, rule] of Object.entries(spec)) {
    const value = source[key];
    if (value === undefined) { if (rule.required) push(label(key), 'is required'); continue; }
    if (value === null) {
      if (rule.nullable) out[key] = null; else push(label(key), rule.required ? 'is required' : 'must not be null');
      continue;
    }
    const problem = typeProblem(value, rule.type);
    if (problem) push(label(key), problem); else out[key] = value;
  }
  return out;
}

/** Returns { session, tasks, topK? } containing only whitelisted, type-checked fields, or throws AppError(422 validation_error). */
function validateRecommendationRequest(body) {
  const errors = [];
  if (!isPlainObject(body)) throw new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors: [{ field: null, message: 'request body must be a JSON object' }] });
  for (const key of Object.keys(body)) if (!['session', 'tasks', 'topK'].includes(key)) errors.push({ field: String(key).slice(0, 60), message: 'unknown property' });

  const session = body.session === undefined ? (errors.push({ field: 'session', message: 'is required' }), {}) : validateObject(body.session, SESSION_SPEC, 'session', errors);
  const tasks = [];
  if (body.tasks === undefined) errors.push({ field: 'tasks', message: 'is required' });
  else if (!Array.isArray(body.tasks)) errors.push({ field: 'tasks', message: 'must be an array' });
  else if (body.tasks.length > MAX_TASKS_PER_REQUEST) errors.push({ field: 'tasks', message: `must contain at most ${MAX_TASKS_PER_REQUEST} tasks` });
  else body.tasks.forEach((task, i) => tasks.push(validateObject(task, TASK_SPEC, `tasks[${i}]`, errors)));

  let topK;
  if (body.topK !== undefined) {
    if (Number.isInteger(body.topK) && body.topK >= 1) topK = body.topK; else errors.push({ field: 'topK', message: 'must be an integer of at least 1' });
  }
  if (errors.length) throw new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors: errors.slice(0, MAX_ERRORS) });
  return topK === undefined ? { session, tasks } : { session, tasks, topK };
}

module.exports = { validateRecommendationRequest, MAX_TASKS_PER_REQUEST, localDateTimeProblem, SESSION_FIELDS, TASK_FIELDS };
