'use strict';
const { AppError } = require('../errors/AppError');
const { PY_TO_CAMEL } = require('./fields');

// Translates a Python 422 body into a safe Node validation error. Upstream message text is NEVER forwarded: each known
// engine message pattern is rebuilt from a template using only identifiers we extract and sanitize (field names via the
// field table, task ids, allowed values). Anything unrecognized becomes a generic message.

const MAX_ENTRIES = 50;
const GENERIC = 'The request contains invalid data';
const SAFE_ID = /^[\w .:\-]{1,100}$/;
const SAFE_VALUE = /'([A-Za-z][A-Za-z ]{0,30})'/g;

const camel = (name) => (typeof name === 'string' && Object.hasOwn(PY_TO_CAMEL, name) ? PY_TO_CAMEL[name] : null);

/** "tasks.0.is_splittable" -> "tasks[0].isSplittable"; any unknown segment makes the whole field null (never echoed). */
function translateField(path) {
  if (typeof path !== 'string' || !path) return null;
  let out = '';
  for (const part of path.split('.')) {
    if (/^\d+$/.test(part)) { out += `[${part}]`; continue; }
    const name = camel(part);
    if (!name) return null;
    out += out ? `.${name}` : name;
  }
  return out;
}

function ids(text) {
  if (!text) return undefined;
  const list = text.split(', ').map((s) => s.trim()).filter((s) => SAFE_ID.test(s)).slice(0, 5);
  return list.length ? list : undefined;
}

function allowed(text) { const values = [...String(text).matchAll(SAFE_VALUE)].map((m) => m[1]); return values.length ? values.join(', ') : null; }

const entry = (field, message, taskIds) => (taskIds ? { field, message, taskIds } : { field, message });

/** Rules over the engine's message text (after the trailing "(task_id: ...)" is split off). First match wins. */
const RULES = [
  [/^missing required task field\(s\): (.+)$/, (m) => m[1].split(', ').map((n) => entry(camel(n), 'is required'))],
  [/^task_id is missing or blank/, () => [entry('taskId', 'is required and must not be blank')]],
  [/^duplicate task_id: (.+)$/, (m, t, rawIds) => [entry('taskId', 'must be unique', ids(m[1]))]],
  [/^(\w+) is missing$/, (m, t) => [entry(camel(m[1]), 'is required', t)]],
  [/^is_splittable must be true or false$/, (m, t) => [entry('isSplittable', 'must be true or false', t)]],
  [/^(\w+) must be a number(?: \(.*\))?$/, (m, t) => [entry(camel(m[1]), 'must be a number', t)]],
  [/^minimum_session_minutes must be a number greater than 0 for splittable tasks$/, (m, t) => [entry('minimumSessionMinutes', 'must be a number greater than 0 for splittable tasks', t)]],
  [/^minimum_session_minutes must not exceed estimated_duration_minutes for splittable tasks$/, (m, t) => [entry('minimumSessionMinutes', 'must not exceed estimatedDurationMinutes for splittable tasks', t)]],
  [/^(\w+) must not be negative/, (m, t) => [entry(camel(m[1]), 'must not be negative', t)]],
  [/^(\w+) must not be zero$/, (m, t) => [entry(camel(m[1]), 'must be greater than zero', t)]],
  [/^dependency_status invalid; allowed \[(.*)\] or null$/, (m, t) => [entry('dependencyStatus', withAllowed('has an invalid value', m[1]), t)]],
  [/^(\w+) has invalid value\(s\) .*?; allowed: \[(.*)\]$/, (m, t) => [entry(camel(m[1]), withAllowed('has an invalid value', m[2]), t)]],
  [/^(\w+) .+ is invalid; allowed: \[(.*)\]$/, (m, t) => [entry(camel(m[1]), withAllowed('has an invalid value', m[2]), t)]],
  [/^(\w+): timezone offsets are not supported/, (m, t) => [entry(camel(m[1]), 'must be a local date/time without a timezone offset (no "Z" or ±hh:mm)', t)]],
  [/^(\w+): unparseable or mixed-timezone values/, (m, t) => [entry(camel(m[1]), 'must be a valid local date/time', t)]],
  [/^(\w+) is not a valid date(?:\/time)?(?: .*)?$/, (m, t) => [entry(camel(m[1]), 'must be a valid local date/time', t)]],
  [/^session must be an object/, () => [entry('session', 'must be an object')]],
  [/^Input should be a valid list$/, (m, t, field) => [entry(translateField(field), 'must be an array')]],
  [/^Field required$/, (m, t, field) => [entry(translateField(field), 'is required')]],
];

function withAllowed(prefix, list) { const values = allowed(list); return values ? `${prefix}; allowed values: ${values}` : prefix; }

function interpret(rawMessage, rawField) {
  if (typeof rawMessage !== 'string' || rawMessage.length > 2000) return null;
  const tail = /^(.*?)(?: \(task_id: ([^)]*)\))?$/s.exec(rawMessage);
  const head = tail[1], taskIds = ids(tail[2]);
  for (const [re, build] of RULES) {
    const m = re.exec(head);
    if (m) return build(m, taskIds, rawField).map((e) => ({ ...e, field: e.field ?? null }));
  }
  return null;
}

/** Python 422 response body -> AppError(422 validation_error) with safe, camelCase entries (max 50). */
function toValidationAppError(body) {
  const entries = [];
  if (body && typeof body === 'object' && body.error === 'validation_error' && Array.isArray(body.errors)) {
    for (const e of body.errors) {
      if (entries.length >= MAX_ENTRIES) break;
      const mapped = e && typeof e === 'object' ? interpret(e.message, e.field) : null;
      if (mapped) entries.push(...mapped); else entries.push({ field: e && typeof e === 'object' ? translateField(e.field) : null, message: GENERIC });
    }
  }
  if (!entries.length) entries.push({ field: null, message: GENERIC });
  return new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors: entries.slice(0, MAX_ENTRIES) });
}

module.exports = { toValidationAppError, translateField, GENERIC };
