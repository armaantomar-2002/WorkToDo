'use strict';
const { AppError } = require('../../errors/AppError');
const { parseLocalDateTime } = require('../../utils/dates');
const { validateBody, validateQuery, validationError, UUID_RE } = require('../../http/validate');
const D = require('../../constants/domain');

const MAX_DURATION = 10080; // one week, in minutes

const TASK_SPEC = {
  taskName: { type: 'string', required: true, minLength: 1, maxLength: 200 },
  description: { type: 'string', nullable: true, maxLength: 2000 },
  startDate: { type: 'date', nullable: true }, dueDate: { type: 'date', nullable: true },
  importance: { type: 'enum', values: D.IMPORTANCE, required: true },
  goalContribution: { type: 'enum', values: D.GOAL_CONTRIBUTION, required: true },
  consequenceOfDelay: { type: 'enum', values: D.CONSEQUENCE_OF_DELAY, required: true },
  // Complexity is no longer asked from users. It still feeds the ML energy-suitability factor, so new tasks get the neutral
  // 'Moderate' and existing/stored (or explicitly supplied) values are kept. Optional for backward compatibility with old API clients.
  complexity: { type: 'enum', values: D.COMPLEXITY },
  estimatedDurationMinutes: { type: 'int', min: 1, max: MAX_DURATION, required: true },
  minimumSessionMinutes: { type: 'int', min: 1, max: MAX_DURATION, nullable: true },
  isSplittable: { type: 'boolean' },
  preferredTime: { type: 'enum', values: D.PREFERRED_TIME },
  status: { type: 'enum', values: D.TASK_STATUS },
};
// dependencyStatus is NOT client-writable: it is derived from real task dependencies (see dependencies.js).

/** Cross-field rules shared by create and update (evaluated on the merged, final task). */
function crossFieldErrors(t) {
  const errors = [];
  if (t.startDate && t.dueDate && t.dueDate < t.startDate) errors.push({ field: 'dueDate', message: 'must not be before the start date' });
  if (t.isSplittable) {
    if (t.minimumSessionMinutes == null) errors.push({ field: 'minimumSessionMinutes', message: 'is required when the task is splittable' });
    else if (t.minimumSessionMinutes > t.estimatedDurationMinutes) errors.push({ field: 'minimumSessionMinutes', message: 'must not exceed the estimated duration' });
  }
  return errors;
}

/** Normalises a final task: non-splittable tasks never carry a minimum session length (Python requires it only when splittable). */
function normalise(t) {
  const out = { ...t };
  if (!out.isSplittable) out.minimumSessionMinutes = null;
  return out;
}

const withDefaults = (d) => ({
  description: null, startDate: null, dueDate: null, minimumSessionMinutes: null, isSplittable: false,
  preferredTime: 'Anytime', status: 'Pending', complexity: 'Moderate', ...d,
});

// ---- fixed-time tasks: { fixedTime: { startAt, durationMinutes } }. The Appointment created from it is the ONLY holder of the date and times. ----
const FIXED_SPEC = { startAt: { type: 'datetime', required: true }, durationMinutes: { type: 'int', min: 1, max: 1440, required: true } };
const wall = (v) => v.replace(' ', 'T').slice(0, 16);
function fixedTimeInput(raw) {
  const f = validateBody(raw, FIXED_SPEC);
  if (!parseLocalDateTime(f.startAt)) throw validationError([{ field: 'fixedTime.startAt', message: 'must be a valid local date and time' }]);
  return { startAt: wall(f.startAt), durationMinutes: f.durationMinutes };
}
/** Splits an optional fixedTime off a request body; for a fixed-time task the appointment duration IS the task duration. */
function splitFixed(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('fixedTime' in body)) return { rest: body, fixedTime: undefined };
  const { fixedTime, ...rest } = body;
  if (fixedTime === null) return { rest, fixedTime: null };
  const f = fixedTimeInput(fixedTime);
  return { rest: { ...rest, estimatedDurationMinutes: f.durationMinutes, isSplittable: false, minimumSessionMinutes: null }, fixedTime: f };
}

function createInput(body) {
  const { rest, fixedTime } = splitFixed(body);
  const data = withDefaults(validateBody(rest, TASK_SPEC));
  if (fixedTime) data.dueDate = fixedTime.startAt.slice(0, 10); // an exact-time commitment is "due" on its own day
  const errors = crossFieldErrors(data);
  if (errors.length) throw validationError(errors);
  return { ...normalise(data), ...(fixedTime ? { fixedTime } : {}) };
}

/** Validates a PATCH body and merges it onto `existing` (a plain object in API shape). Returns only the changed, final values. */
function updateInput(body, existing) {
  const { rest, fixedTime } = splitFixed(body);
  // a fixed-time task's duration/splitting come from its appointment and are changed only through fixedTime
  const bodyRest = existing.appointmentId && fixedTime === undefined ? Object.fromEntries(Object.entries(rest ?? {}).filter(([k]) => !['estimatedDurationMinutes', 'isSplittable', 'minimumSessionMinutes'].includes(k))) : rest;
  const patch = validateBody(bodyRest, TASK_SPEC, { partial: true });
  if (fixedTime) patch.dueDate = fixedTime.startAt.slice(0, 10);
  if (Object.keys(patch).length === 0 && fixedTime === undefined) throw validationError([{ field: 'body', message: 'must contain at least one field to update' }]);
  const merged = normalise({ ...existing, ...patch });
  const errors = crossFieldErrors(merged);
  if (errors.length) throw validationError(errors);
  return { patch: { ...patch, ...(patch.isSplittable === false ? { minimumSessionMinutes: null } : {}) }, merged, fixedTime };
}

const dependencyInput = (body) => {
  const d = validateBody(body, { dependsOnTaskId: { type: 'string', required: true, maxLength: 36 } });
  if (!UUID_RE.test(d.dependsOnTaskId)) throw validationError([{ field: 'dependsOnTaskId', message: 'must be a valid id' }]);
  return { dependsOnTaskId: d.dependsOnTaskId.toLowerCase() };
};
const statusInput = (body) => validateBody(body, { status: { type: 'enum', values: D.TASK_STATUS, required: true } });

const SORTABLE = ['createdAt', 'dueDate', 'importance', 'taskName', 'status', 'estimatedDurationMinutes'];
function listQuery(query) {
  const q = validateQuery(query, {
    search: { type: 'string', maxLength: 100 }, status: { type: 'string', maxLength: 80 }, importance: { type: 'string', maxLength: 60 },
    dependencyStatus: { type: 'enum', values: D.DEPENDENCY_STATUS }, dueFrom: { type: 'date' }, dueTo: { type: 'date' },
    sortBy: { type: 'enum', values: SORTABLE }, sortOrder: { type: 'enum', values: ['asc', 'desc'] },
    page: { type: 'int', min: 1, max: 100000 }, pageSize: { type: 'int', min: 1, max: 100 },
  });
  const csv = (value, allowed, field) => {
    if (value === undefined) return undefined;
    const parts = value.split(',').map((x) => x.trim()).filter(Boolean);
    const bad = parts.filter((p) => !allowed.includes(p));
    if (bad.length || parts.length === 0) throw validationError([{ field, message: `must be a comma-separated list of: ${allowed.join(', ')}` }]);
    return parts;
  };
  return {
    search: q.search || undefined, status: csv(q.status, D.TASK_STATUS, 'status'), importance: csv(q.importance, D.IMPORTANCE, 'importance'),
    dependencyStatus: q.dependencyStatus, dueFrom: q.dueFrom, dueTo: q.dueTo,
    sortBy: q.sortBy ?? 'createdAt', sortOrder: q.sortOrder ?? 'desc', page: q.page ?? 1, pageSize: q.pageSize ?? 10,
  };
}
module.exports = { createInput, updateInput, statusInput, dependencyInput, listQuery, crossFieldErrors, SORTABLE, MAX_DURATION, TASK_SPEC };
