'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateRecommendationRequest: validate, MAX_TASKS_PER_REQUEST, localDateTimeProblem } = require('../src/validators/recommendationRequest');
const { AppError } = require('../src/errors/AppError');

const golden = require('./fixtures/ml/scenario-golden.json').publicRequest;
const clone = (o) => JSON.parse(JSON.stringify(o));
const task = (extra = {}) => ({ taskId: 'T', taskName: 'n', startDate: '2026-11-01', dueDate: '2026-11-20', importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Major', complexity: 'Simple', estimatedDurationMinutes: 30, minimumSessionMinutes: 30, isSplittable: false, preferredTime: 'Anytime', dependencyStatus: 'No dependency', status: 'Pending', ...extra });
const body = (t = [task()], session = {}) => ({ session: { ...golden.session, ...session }, tasks: t });
const errorsOf = (b) => { try { validate(b); } catch (e) { assert.ok(e instanceof AppError); assert.equal(e.status, 422); assert.equal(e.code, 'validation_error'); assert.equal(e.message, 'Request validation failed'); return e.errors; } assert.fail('expected a validation error'); };
const has = (errs, field, text) => assert.ok(errs.some((e) => e.field === field && e.message.includes(text)), `${field} / ${text} not in ${JSON.stringify(errs)}`);

describe('request validation: structure and whitelist', () => {
  it('accepts the golden request and returns only whitelisted fields', () => { const v = validate(clone(golden)); assert.deepEqual(v.session, golden.session); assert.deepEqual(v.tasks, golden.tasks); assert.equal('topK' in v, false); });
  it('keeps topK when valid', () => { assert.equal(validate({ ...body(), topK: 3 }).topK, 3); });
  it('rejects non-object bodies', () => { for (const b of [undefined, null, [], 'x', 5, true]) { const e = errorsOf(b); assert.deepEqual(e, [{ field: null, message: 'request body must be a JSON object' }]); } });
  it('rejects unknown properties at every level (typos are never silently ignored)', () => {
    has(errorsOf({ ...body(), extra: 1 }), 'extra', 'unknown property');
    has(errorsOf(body([task()], { bogus: 1 })), 'session.bogus', 'unknown property');
    has(errorsOf(body([task({ dueDat: '2026-11-17' }), task({ taskId: 'U', dependency_status: 'Blocked' })])), 'tasks[0].dueDat', 'unknown property');
    has(errorsOf(body([task({ dependency_status: 'Blocked' })])), 'tasks[0].dependency_status', 'unknown property'); // snake_case names are not public API
  });
  it('truncates echoed unknown keys', () => { const k = 'k'.repeat(1000); const e = errorsOf({ ...body(), [k]: 1 }); assert.equal(e[0].field.length, 60); });
  it('requires session and tasks; session fields; task fields', () => {
    has(errorsOf({ tasks: [] }), 'session', 'is required'); has(errorsOf({ session: golden.session }), 'tasks', 'is required');
    const s = clone(golden.session); delete s.energyLevel; has(errorsOf({ session: s, tasks: [] }), 'session.energyLevel', 'is required');
    const t = task(); for (const k of ['taskId', 'importance', 'goalContribution', 'consequenceOfDelay', 'complexity', 'estimatedDurationMinutes', 'isSplittable', 'preferredTime', 'status']) { const c = { ...t }; delete c[k]; has(errorsOf(body([c])), `tasks[0].${k}`, 'is required'); }
  });
  it('optional fields may be omitted or null (and are preserved as such)', () => {
    const t = task(); for (const k of ['taskName', 'startDate', 'dueDate', 'minimumSessionMinutes', 'dependencyStatus']) delete t[k];
    assert.deepEqual(Object.keys(validate(body([t])).tasks[0]).sort(), Object.keys(t).sort());
    const n = task({ taskName: null, startDate: null, dueDate: null, minimumSessionMinutes: null, dependencyStatus: null }); assert.deepEqual(validate(body([n])).tasks[0], n);
  });
  it('null is not accepted for required fields', () => { has(errorsOf(body([task({ status: null })])), 'tasks[0].status', 'is required'); has(errorsOf(body([task({ isSplittable: null })])), 'tasks[0].isSplittable', 'is required'); });
});

describe('request validation: JSON types are strict', () => {
  it('rejects wrong types (no numeric strings, no truthy booleans)', () => {
    has(errorsOf(body([task({ estimatedDurationMinutes: '30' })])), 'tasks[0].estimatedDurationMinutes', 'must be a number');
    has(errorsOf(body([task({ isSplittable: 'false' })])), 'tasks[0].isSplittable', 'true or false'); has(errorsOf(body([task({ isSplittable: 0 })])), 'tasks[0].isSplittable', 'true or false');
    has(errorsOf(body([task({ importance: 5 })])), 'tasks[0].importance', 'must be a string'); has(errorsOf(body([task({ taskName: 5 })])), 'tasks[0].taskName', 'must be a string');
    has(errorsOf(body([task({ minimumSessionMinutes: '5' })])), 'tasks[0].minimumSessionMinutes', 'must be a number');
    has(errorsOf(body([], { availableTimeMinutes: '120' })), 'session.availableTimeMinutes', 'must be a number'); has(errorsOf(body([], { energyLevel: 1 })), 'session.energyLevel', 'must be a string');
  });
  it('taskId: non-empty string or safe integer', () => {
    for (const ok of ['T1', 7, 'c0a8-01']) validate(body([task({ taskId: ok })]));
    for (const bad of ['', '   ', 1.5, 2 ** 53, {}, [], true]) has(errorsOf(body([task({ taskId: bad })])), 'tasks[0].taskId', 'non-empty string or a safe integer');
  });
  it('tasks must be an array of objects', () => { has(errorsOf({ session: golden.session, tasks: {} }), 'tasks', 'must be an array'); has(errorsOf(body([null, 5])), 'tasks[0]', 'must be an object'); });
  it('topK must be an integer >= 1', () => { for (const bad of [0, -1, 1.5, '3', null, true]) has(errorsOf({ ...body(), topK: bad }), 'topK', 'integer of at least 1'); });
  it('allowed values and domain rules are NOT checked here (Python stays the authority)', () => {
    validate(body([task({ importance: 'Urgent', estimatedDurationMinutes: -5, status: 'whatever', dependencyStatus: 'blocked' })], { currentTimePeriod: 'Noon', availableTimeMinutes: -1 }));
    validate(body([task({ taskId: 'D' }), task({ taskId: 'D' })])); // duplicates are Python's call
  });
});

describe('request validation: local date/time rules (no timezone interpretation)', () => {
  const lt = (v) => localDateTimeProblem(v, { allowDateOnly: false }), dt = (v) => localDateTimeProblem(v, { allowDateOnly: true });
  it('accepts valid local wall-clock values, including DST gaps/overlaps and leap days (arithmetic only)', () => {
    for (const v of ['2026-11-16 10:00:00', '2026-11-16T10:00', '2026-11-16T10:00:00', '2026-03-08 02:30:00', '2026-10-25 01:30:00', '2028-02-29 23:59:59', '2026-12-31 00:00:00']) assert.equal(lt(v), null, v);
  });
  it('accepts HH:mm and HH:mm:ss with a space or T separator', () => {
    for (const v of ['2026-11-16 10:00', '2026-11-16 10:00:00', '2026-11-16T10:00', '2026-11-16T10:00:00']) { assert.equal(lt(v), null, v); assert.equal(dt(v), null, v); }
  });
  it('rejects fractional seconds in every form (localTime and task dates)', () => {
    for (const v of ['2026-11-16 10:00:00.123', '2026-11-16T10:00:00.000', '2026-11-16 10:00:00.5', '2026-11-16 10:00.5', '2026-11-16 10:00:00.', '2026-11-16 10:00:00,5', '2026-11-16T10:00:00.123456789']) { assert.match(lt(v), /local date-time like/, v); assert.match(dt(v), /local date/, v); }
  });
  it('fractional seconds are rejected by the validator with the right field path', () => {
    has(errorsOf(body([task()], { localTime: '2026-11-16 10:00:00.123' })), 'session.localTime', 'local date-time like'); has(errorsOf(body([task({ dueDate: '2026-11-20T10:00:00.5' })])), 'tasks[0].dueDate', 'local date');
  });
  it('rejects Z-suffixed and offset values for localTime and for task dates', () => {
    for (const v of ['2026-11-16T10:00:00Z', '2026-11-16 10:00:00z', '2026-11-16T10:00:00+05:30', '2026-11-16 10:00:00-0800', '2026-11-16T10:00-08', '2026-11-16T10:00:00.000Z', '2026-11-16 10:00:00.5+01:00']) { assert.match(lt(v), /without a timezone offset/, v); assert.match(dt(v), /without a timezone offset/, v); }
    assert.match(dt('2026-11-16Z'), /without a timezone offset/); assert.match(dt('2026-11-16+01:00'), /without a timezone offset/);
  });
  it('localTime needs date AND time; task dates may be date-only', () => { assert.match(lt('2026-11-16'), /local date-time/); assert.equal(dt('2026-11-16'), null); assert.equal(dt('2026-11-16 08:30'), null); });
  it('rejects impossible calendar values and malformed strings', () => {
    for (const v of ['2026-02-30 10:00:00', '2027-02-29 10:00:00', '2026-13-01 10:00:00', '2026-11-16 24:00:00', '2026-11-16 10:60:00', '2026-11-16 10:00:60', '16/11/2026 10:00', 'garbage', '', ' 2026-11-16 10:00:00']) assert.ok(lt(v), v);
    for (const v of ['2026-02-30', '2026-00-10', '', 'x']) assert.ok(dt(v), v);
    assert.equal(lt(5), 'must be a string');
  });
  it('validator reports offsets with the right field paths', () => {
    has(errorsOf(body([task()], { localTime: '2026-11-16T10:00:00Z' })), 'session.localTime', 'timezone offset'); has(errorsOf(body([task({ dueDate: '2026-11-20T10:00:00+05:30' })])), 'tasks[0].dueDate', 'timezone offset'); has(errorsOf(body([task({ startDate: '' })])), 'tasks[0].startDate', 'must be a local date');
  });
});

describe('request validation: limits and error reporting', () => {
  it('allows empty task lists and exactly 500 tasks; rejects 501', () => {
    assert.deepEqual(validate(body([])).tasks, []); assert.equal(MAX_TASKS_PER_REQUEST, 500);
    assert.equal(validate(body(Array.from({ length: 500 }, (_, i) => task({ taskId: `T${i}` })))).tasks.length, 500);
    has(errorsOf(body(Array.from({ length: 501 }, (_, i) => task({ taskId: `T${i}` })))), 'tasks', 'at most 500 tasks');
  });
  it('reports all problems together with indexed paths, capped at 50', () => {
    const e = errorsOf(body([task(), task({ importance: 5, status: null }), task({ isSplittable: 'x' })])); has(e, 'tasks[1].importance', 'must be a string'); has(e, 'tasks[1].status', 'is required'); has(e, 'tasks[2].isSplittable', 'true or false');
    assert.equal(errorsOf(body(Array.from({ length: 100 }, () => ({})))).length, 50);
  });
});
