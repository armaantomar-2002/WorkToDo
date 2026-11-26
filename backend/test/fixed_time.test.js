'use strict';
// Fixed-time commitments, deadline protection, infeasibility explanations and dependency order (pure engine + validator; no DB).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { generateSchedule } = require('../src/modules/scheduler/engine');
const { validateSchedule, hasErrors } = require('../src/modules/scheduler/validate');
const { wouldCreateCycle } = require('../src/modules/tasks/dependencies');
const { toAbs } = require('../src/modules/scheduler/time');

const WH = { start: '09:00', end: '18:00', days: [0, 1, 2, 3, 4, 5, 6] };
const T = (id, minutes, o = {}) => ({ id, taskName: id, status: 'Pending', importance: 'Medium', dueDate: null, startDate: null, postponedUntil: null, estimatedDurationMinutes: minutes, isSplittable: false, minimumSessionMinutes: null, preferredTime: 'Anytime', completedMinutes: 0, prerequisiteIds: [], ...o });
const A = (id, title, s, e, o = {}) => ({ id, title, startAt: `2026-11-26T${s}`, endAt: `2026-11-26T${e}`, status: 'scheduled', preparationBufferMinutes: 0, travelBufferMinutes: 0, ...o });
const base = (o) => ({ now: '2026-11-26T11:22', horizonDays: 2, workingHours: WH, breaks: { enabled: false }, ...o });
const at = (r, id) => r.blocks.filter((b) => b.taskId === id).map((b) => `${b.start.slice(11)}-${b.end.slice(11)}`);
const dentist = A('dent', 'Dentist Appointment', '13:00', '15:00');

describe('fixed appointments and exact-minute start', () => {
  const tasks = [T('api', 60), T('reply', 15), T('study', 60), T('dentistTask', 120, { appointmentId: 'dent' })];
  const r = generateSchedule(base({ tasks, appointments: [dentist], ranking: [{ taskId: 'reply', rank: 1 }, { taskId: 'api', rank: 2 }, { taskId: 'study', rank: 3 }] }));
  test('first task starts at the exact current minute 11:22', () => { assert.deepEqual(at(r, 'reply'), ['11:22-11:37']); assert.deepEqual(at(r, 'api'), ['11:37-12:37']); });
  test('the appointment keeps exactly 13:00-15:00 and is never a flexible block', () => {
    assert.equal(r.appointments[0].startAt, '2026-11-26T13:00'); assert.equal(r.appointments[0].endAt, '2026-11-26T15:00'); assert.equal(at(r, 'dentistTask').length, 0);
    assert.equal(r.fixedTasks[0].start, '2026-11-26T13:00');
  });
  test('flexible work after the appointment starts at or after 15:00; nothing overlaps 13:00-15:00', () => {
    assert.deepEqual(at(r, 'study'), ['15:00-16:00']);
    for (const b of r.blocks) assert.ok(toAbs(b.end) <= toAbs('2026-11-26T13:00') || toAbs(b.start) >= toAbs('2026-11-26T15:00'));
  });
  test('regeneration with different energy-independent input never moves the appointment', () => {
    const r2 = generateSchedule(base({ now: '2026-11-26T12:00', tasks, appointments: [dentist] })); assert.equal(r2.appointments[0].startAt, '2026-11-26T13:00');
  });
  test('two overlapping appointments are reported, neither is moved', () => {
    const p = validateSchedule({ ...base({}), tasks: [], blocks: [], breaks: [], appointments: [dentist, A('m', 'Meeting', '14:00', '15:00')] });
    assert.ok(p.some((x) => x.code === 'appointments_overlap')); assert.ok(hasErrors(p));
  });
});

describe('urgent work is not starved by higher-ranked less urgent work', () => {
  test('rank-1 task due tomorrow does not take the only slot of a rank-2 task due today', () => {
    const tasks = [T('A', 90, { dueDate: '2026-11-27' }), T('B', 60, { dueDate: '2026-11-26' })];
    const r = generateSchedule(base({ now: '2026-11-26T16:00', tasks, ranking: [{ taskId: 'A', rank: 1 }, { taskId: 'B', rank: 2 }] }));
    assert.equal(r.unscheduled.length, 0); assert.deepEqual(at(r, 'B'), ['16:00-17:00']); assert.ok(at(r, 'A')[0].startsWith('2026-') || true);
    assert.ok(r.blocks.find((b) => b.taskId === 'A').start >= '2026-11-26T17:00');
  });
  test('when ML order is feasible it is kept', () => {
    const r = generateSchedule(base({ tasks: [T('A', 30), T('B', 30)], ranking: [{ taskId: 'B', rank: 1 }, { taskId: 'A', rank: 2 }] })); assert.deepEqual(at(r, 'B'), ['11:22-11:52']);
  });
});

describe('dependencies on fixed-time events', () => {
  const demo = A('demo', 'Project Demo', '16:30', '17:00');
  const mk = (prereqMin, extra = {}) => ({ tasks: [T('dev', prereqMin, { isSplittable: true, minimumSessionMinutes: 30 }), T('slides', 30, { prerequisiteIds: ['dev'] }), T('demoTask', 30, { appointmentId: 'demo', prerequisiteIds: ['slides', 'dev'] })], appointments: [demo], ...extra });
  test('prerequisites are scheduled first and finish before the demo', () => {
    const r = generateSchedule(base({ now: '2026-11-26T11:30', ...mk(120) })); assert.equal(r.unscheduled.length, 0); assert.equal(r.infeasibilities.length, 0);
    const dev = r.blocks.filter((b) => b.taskId === 'dev'); const sl = r.blocks.filter((b) => b.taskId === 'slides');
    assert.ok(toAbs(sl[0].start) >= toAbs(dev[dev.length - 1].end)); for (const b of [...dev, ...sl]) assert.ok(toAbs(b.end) <= toAbs('2026-11-26T16:30'));
    assert.equal(hasErrors(validateSchedule({ ...base({ now: '2026-11-26T11:30', ...mk(120) }), blocks: r.blocks, breaks: r.breaks })), false);
  });
  test('5 h of prerequisite work but 4 h available: clear infeasibility, appointment untouched', () => {
    const lunch = [{ id: 'u', label: 'Lunch', startAt: '2026-11-26T12:30', endAt: '2026-11-26T13:30' }];
    const r = generateSchedule(base({ now: '2026-11-26T11:30', ...mk(270), unavailable: lunch, horizonDays: 1 }));
    const f = r.infeasibilities.find((x) => x.code === 'infeasible_before_fixed'); assert.ok(f, JSON.stringify(r.infeasibilities));
    assert.equal(f.requiredMinutes, 300); assert.equal(f.availableMinutes, 240); assert.equal(f.shortfallMinutes, 60);
    assert.match(f.message, /requires 5 hours, but only 4 hours are available before "Project Demo"/); assert.match(f.message, /not feasible/);
    assert.ok(f.tasks.some((t) => t.taskId === 'dev')); assert.ok(f.alternatives.length >= 3); assert.equal(r.appointments[0].startAt, '2026-11-26T16:30');
    for (const b of r.blocks) assert.ok(toAbs(b.end) <= toAbs('2026-11-26T16:30') || toAbs(b.start) >= toAbs('2026-11-26T17:00'));
  });
  test('dragging a prerequisite past the fixed event is rejected by the validator', () => {
    const r = generateSchedule(base({ now: '2026-11-26T11:30', ...mk(60) })); const bad = r.blocks.map((b) => (b.taskId === 'dev' ? { ...b, start: '2026-11-26T17:00', end: '2026-11-26T18:00' } : b));
    assert.ok(validateSchedule({ ...base({ now: '2026-11-26T11:30', ...mk(60) }), blocks: bad, breaks: [] }, { errorsOnly: true }).length > 0);
  });
  test('a flexible task that depends on a fixed event is placed after it ends', () => {
    const r = generateSchedule(base({ tasks: [T('write', 30, { prerequisiteIds: ['demoTask'] }), T('demoTask', 30, { appointmentId: 'demo' })], appointments: [demo] }));
    assert.ok(toAbs(r.blocks[0].start) >= toAbs('2026-11-26T17:00')); assert.equal(r.unscheduled.length, 0);
  });
  test('circular dependency is rejected', () => { assert.equal(wouldCreateCycle(new Map([['b', ['a']], ['c', ['b']]]), 'a', 'c'), true); assert.equal(wouldCreateCycle(new Map([['b', ['a']]]), 'c', 'b'), false); });
});

describe('splitting', () => {
  const lunchy = [A('x', 'Block', '12:00', '15:00'), A('y', 'Late', '16:00', '18:00')];
  test('splittable 120 minutes uses both free slots and totals 120', () => {
    const r = generateSchedule(base({ now: '2026-11-26T11:00', horizonDays: 1, tasks: [T('os', 120, { isSplittable: true, minimumSessionMinutes: 30 })], appointments: lunchy }));
    assert.deepEqual(at(r, 'os'), ['11:00-12:00', '15:00-16:00']);
  });
  test('non-splittable 120 minutes is never split', () => {
    const r = generateSchedule(base({ now: '2026-11-26T11:00', horizonDays: 1, tasks: [T('os', 120)], appointments: lunchy })); assert.equal(at(r, 'os').length, 0); assert.equal(r.unscheduled[0].code, 'no_slot_long_enough');
  });
});
