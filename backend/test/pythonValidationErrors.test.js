'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toValidationAppError: map, translateField, GENERIC } = require('../src/mappers/pythonValidationErrors');
const { AppError } = require('../src/errors/AppError');

const samples = require('./fixtures/ml/python-422-samples.json').samples;
const by = (label) => map(samples.find((s) => s.label === label).body).errors;
const flat = (errs) => errs.map((e) => `${e.field}: ${e.message}`);

describe('Python 422 -> safe Node validation errors (real engine messages)', () => {
  it('returns AppError(422 validation_error) with the Node message, never the Python one', () => {
    for (const s of samples) { const e = map(s.body); assert.ok(e instanceof AppError); assert.deepEqual([e.status, e.code, e.message], [422, 'validation_error', 'Request validation failed']); assert.ok(e.errors.length >= 1 && e.errors.length <= 50); }
  });
  it('translates field names to camelCase and rebuilds messages from templates', () => {
    assert.deepEqual(by('invalid importance'), [{ field: 'importance', message: 'has an invalid value; allowed values: Critical, High, Low, Medium', taskIds: ['A'] }]);
    assert.deepEqual(by('duplicate ids'), [{ field: 'taskId', message: 'must be unique', taskIds: ['D'] }]);
    assert.deepEqual(by('negative duration'), [{ field: 'estimatedDurationMinutes', message: 'must not be negative', taskIds: ['A'] }]);
    assert.deepEqual(by('zero duration'), [{ field: 'estimatedDurationMinutes', message: 'must be greater than zero', taskIds: ['A'] }]);
    assert.deepEqual(by('splittable min > duration'), [{ field: 'minimumSessionMinutes', message: 'must not exceed estimatedDurationMinutes for splittable tasks', taskIds: ['A'] }]);
    assert.deepEqual(by('missing is_splittable column'), [{ field: 'isSplittable', message: 'is required' }]);
    assert.deepEqual(by('tz offset session'), [{ field: 'localTime', message: 'must be a local date/time without a timezone offset (no "Z" or ±hh:mm)' }]);
    assert.deepEqual(by('invalid session timestamp'), [{ field: 'localTime', message: 'must be a valid local date/time' }]);
    assert.deepEqual(by('negative available'), [{ field: 'availableTimeMinutes', message: 'must not be negative' }]);
    assert.deepEqual(by('non-numeric slot'), [{ field: 'longestFreeSlotMinutes', message: 'must be a number' }]);
    assert.deepEqual(by('missing session field'), [{ field: 'energyLevel', message: 'is required' }]);
    assert.deepEqual(by('pydantic: session missing'), [{ field: 'session', message: 'is required' }]); assert.deepEqual(by('pydantic: nested'), [{ field: 'tasks[0].isSplittable', message: 'is required' }]);
    assert.deepEqual(by('pydantic: tasks wrong type'), [{ field: 'tasks', message: 'must be an array' }]);
  });
  it('multi-error bodies map entry by entry', () => { const m = flat(by('many problems at once')); assert.ok(m.includes('availableTimeMinutes: must not be negative')); assert.ok(m.some((x) => x.startsWith('currentTimePeriod: has an invalid value'))); assert.ok(m.includes('status: is required')); assert.ok(m.includes('estimatedDurationMinutes: must not be negative')); assert.ok(m.includes('dueDate: must be a valid local date/time')); });
  it('EVERY real sample produces only safe output: no snake_case names, paths, quotes of raw values or upstream text', () => {
    for (const s of samples) for (const e of map(s.body).errors) {
      const text = JSON.stringify(e);
      assert.ok(e.field === null || /^[A-Za-z]+(\[\d+\])?(\.[A-Za-z]+(\[\d+\])?)*$/.test(e.field), `${s.label}: field ${e.field}`);
      assert.doesNotMatch(text, /[a-z]+_[a-z]+|Traceback|\/(etc|srv|home|usr|mnt|var|app|tmp)\b|[A-Za-z]:\\|'|task_id|Input should|Invalid input|https?:/i, `${s.label}: ${text}`);
    }
  });
  it('no raw upstream message is ever forwarded verbatim', () => { for (const s of samples) { const raw = new Set(s.body.errors.map((e) => e.message)); for (const e of map(s.body).errors) assert.ok(!raw.has(e.message), s.label); } });
});

describe('hostile or unknown upstream formats use a generic safe message', () => {
  const generic = [{ field: null, message: GENERIC }];
  it('non-validation or malformed bodies', () => { for (const b of [null, undefined, 'x', 5, [], {}, { error: 'other', errors: [{ message: 'x' }] }, { error: 'validation_error' }, { error: 'validation_error', errors: [] }, { error: 'validation_error', errors: 'nope' }]) assert.deepEqual(map(b).errors, generic, JSON.stringify(b)); });
  it('unknown message formats never leak their text', () => {
    const hostile = 'Traceback (most recent call last):\n  File "/srv/worktodo_service/app/main.py", line 10\nKeyError: secret-token http://127.0.0.1:8000';
    const e = map({ error: 'validation_error', errors: [{ field: 'status', message: hostile }, { field: '../../etc/passwd', message: hostile }, { field: 'tasks.0.__proto__', message: hostile }, { message: 5 }, null, 'str'] }).errors;
    assert.deepEqual(e, [{ field: 'status', message: GENERIC }, { field: null, message: GENERIC }, { field: null, message: GENERIC }, { field: null, message: GENERIC }, { field: null, message: GENERIC }, { field: null, message: GENERIC }]);
    assert.doesNotMatch(JSON.stringify(e), /Traceback|\/srv|127\.0\.0\.1|secret/);
  });
  it('sanitizes extracted ids and allowed values', () => {
    const e = map({ error: 'validation_error', errors: [{ field: 'importance', message: "importance has invalid value(s) 'x'; allowed: ['/etc/passwd', \"<script>\"] (task_id: ../../etc/passwd, OK-1, a b, <img src=x>)" }] }).errors;
    assert.deepEqual(e, [{ field: 'importance', message: 'has an invalid value', taskIds: ['OK-1', 'a b'] }]);
  });
  it('caps the number of entries at 50', () => { const many = Array.from({ length: 200 }, (_, i) => ({ field: 'status', message: `status is missing (task_id: T${i})` })); assert.equal(map({ error: 'validation_error', errors: many }).errors.length, 50); });
  it('translateField handles paths and rejects unknown segments', () => {
    assert.equal(translateField('tasks.12.estimated_duration_minutes'), 'tasks[12].estimatedDurationMinutes'); assert.equal(translateField('session.session_timestamp'), 'session.localTime'); assert.equal(translateField('top_k'), 'topK');
    for (const bad of [null, undefined, '', 'nope', 'tasks.0.nope', '__proto__', 5]) assert.equal(translateField(bad), null);
  });
});
