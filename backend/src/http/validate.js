'use strict';
const { AppError } = require('../errors/AppError');
const { parseDateOnly, parseLocalDateTime } = require('../utils/dates');

// Whitelist body validator. spec: { field: { type, required?, nullable?, min?, max?, values?, trim?, maxLength?, minLength? } }.
// Types: string | email | int | boolean | enum | date | datetime | timezone. Unknown fields are rejected. Returns a cleaned copy.

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validationError(errors) {
  return new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors: errors.slice(0, 50) });
}

function check(value, rule) {
  switch (rule.type) {
    case 'string': {
      if (typeof value !== 'string') return ['must be a string'];
      const v = rule.trim === false ? value : value.trim();
      if (rule.minLength !== undefined && v.length < rule.minLength) return [rule.minLength === 1 ? 'must not be empty' : `must be at least ${rule.minLength} characters`];
      if (rule.maxLength !== undefined && v.length > rule.maxLength) return [`must be at most ${rule.maxLength} characters`];
      return [null, v];
    }
    case 'email': {
      if (typeof value !== 'string') return ['must be a string'];
      const v = value.trim().toLowerCase();
      if (v.length > 254 || !EMAIL_RE.test(v)) return ['must be a valid email address'];
      return [null, v];
    }
    case 'int': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return ['must be a whole number'];
      if (rule.min !== undefined && value < rule.min) return [`must be at least ${rule.min}`];
      if (rule.max !== undefined && value > rule.max) return [`must be at most ${rule.max}`];
      return [null, value];
    }
    case 'boolean': return typeof value === 'boolean' ? [null, value] : ['must be true or false'];
    case 'enum': return typeof value === 'string' && rule.values.includes(value) ? [null, value] : [`must be one of: ${rule.values.join(', ')}`];
    case 'date': return parseDateOnly(value) ? [null, value] : ['must be a valid date in YYYY-MM-DD format'];
    case 'datetime': return parseLocalDateTime(value) ? [null, value] : ['must be a local date-time like "YYYY-MM-DD HH:mm:ss" (no timezone offset)'];
    case 'timezone': {
      const { isValidTimeZone } = require('../utils/dates');
      return typeof value === 'string' && isValidTimeZone(value) ? [null, value] : ['must be a valid IANA time zone, e.g. Asia/Kolkata'];
    }
    default: return ['has an unsupported type'];
  }
}

/** @returns {{data: object, errors: Array}} (does not throw) */
function parseBody(body, spec, { partial = false } = {}) {
  const errors = [];
  const data = {};
  if (!isObj(body)) return { data, errors: [{ field: 'body', message: 'must be a JSON object' }] };
  for (const key of Object.keys(body)) if (!Object.hasOwn(spec, key)) errors.push({ field: key, message: 'is not an allowed field' });
  for (const [key, rule] of Object.entries(spec)) {
    const present = Object.hasOwn(body, key) && body[key] !== undefined;
    if (!present) {
      if (rule.required && !partial) errors.push({ field: key, message: 'is required' });
      continue;
    }
    if (body[key] === null) {
      if (rule.nullable) data[key] = null; else errors.push({ field: key, message: 'must not be null' });
      continue;
    }
    const [problem, clean] = check(body[key], rule);
    if (problem) errors.push({ field: key, message: problem }); else data[key] = clean;
  }
  return { data, errors };
}

/** Validates and returns the cleaned body, or throws a 422 validation_error. */
function validateBody(body, spec, opts) {
  const { data, errors } = parseBody(body, spec, opts);
  if (errors.length) throw validationError(errors);
  return data;
}

/** Query-string helper: returns cleaned values for the spec; strings only (query values are always strings). */
function validateQuery(query, spec) {
  const errors = [];
  const data = {};
  for (const [key, rule] of Object.entries(spec)) {
    let raw = query[key];
    if (raw === undefined || raw === '') continue;
    if (Array.isArray(raw) || typeof raw !== 'string') { errors.push({ field: key, message: 'must be a single value' }); continue; }
    if (rule.type === 'int') {
      if (!/^-?\d+$/.test(raw)) { errors.push({ field: key, message: 'must be a whole number' }); continue; }
      raw = Number(raw);
    } else if (rule.type === 'boolean') {
      if (raw !== 'true' && raw !== 'false') { errors.push({ field: key, message: 'must be true or false' }); continue; }
      raw = raw === 'true';
    }
    const [problem, clean] = check(raw, rule);
    if (problem) errors.push({ field: key, message: problem }); else data[key] = clean;
  }
  if (errors.length) throw validationError(errors);
  return data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Route param guard: a malformed id is simply "not found" (never reaches the database, never a 500). */
function assertUuid(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new AppError({ status: 404, code: 'not_found', message: 'Resource not found' });
  return id.toLowerCase();
}
const notFound = (what = 'Resource') => new AppError({ status: 404, code: 'not_found', message: `${what} not found` });

module.exports = { parseBody, validateBody, validateQuery, validationError, assertUuid, notFound, UUID_RE };
