'use strict';
// Fixed-time tasks through the real services on the in-memory Prisma stand-in (hermetic; the DB-level behaviour is in test-db and was NOT run here).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryPrisma } = require('../test-support/memoryPrisma');
const { createTasksService } = require('../src/modules/tasks/tasks.service');
const { createAppointmentsService } = require('../src/modules/planner/appointments.service');
const v = require('../src/modules/tasks/tasks.validator');

const base = { taskName: 'Dentist Appointment', importance: 'High', goalContribution: 'Medium', consequenceOfDelay: 'Moderate', estimatedDurationMinutes: 30 };
const fx = () => { const prisma = createMemoryPrisma(); const appointments = createAppointmentsService({ prisma }); return { prisma, appointments, tasks: createTasksService({ prisma, appointments }) }; };
const U = '11111111-1111-4111-8111-111111111111';

describe('validation', () => {
  test('fixedTime makes the appointment duration the task duration, non-splittable, due on its day', () => {
    const d = v.createInput({ ...base, fixedTime: { startAt: '2026-11-26 13:00:00', durationMinutes: 120 } });
    assert.equal(d.estimatedDurationMinutes, 120); assert.equal(d.isSplittable, false); assert.equal(d.dueDate, '2026-11-26'); assert.deepEqual(d.fixedTime, { startAt: '2026-11-26T13:00', durationMinutes: 120 });
  });
  test('rejects a non-positive duration, an invalid time and unknown fields', () => {
    assert.throws(() => v.createInput({ ...base, fixedTime: { startAt: '2026-11-26T13:00', durationMinutes: 0 } }));
    assert.throws(() => v.createInput({ ...base, fixedTime: { startAt: 'tomorrow', durationMinutes: 30 } }));
    assert.throws(() => v.createInput({ ...base, fixedTime: { startAt: '2026-11-26T13:00', durationMinutes: 30, extra: 1 } }));
  });
  test('flexible tasks are unchanged (no fixedTime key)', () => { assert.equal('fixedTime' in v.createInput(base), false); });
});

describe('service', () => {
  test('creates the task and its appointment together; the appointment holds the time (13:00-15:00), the task only the link', async () => {
    const { tasks, prisma } = fx();
    const t = await tasks.create(U, v.createInput({ ...base, fixedTime: { startAt: '2026-11-26T13:00', durationMinutes: 120 } }));
    assert.equal(t.isFixedTime, true); assert.deepEqual([t.fixedTime.startAt, t.fixedTime.endAt, t.fixedTime.durationMinutes], ['2026-11-26T13:00', '2026-11-26T15:00', 120]);
    const raw = await prisma.task.findFirst({ where: { id: t.id } }); assert.ok(raw.appointmentId); assert.equal('startAt' in raw, false);
  });
  test('an overlapping fixed-time task is rejected (409) and nothing is saved', async () => {
    const { tasks, prisma } = fx();
    await tasks.create(U, v.createInput({ ...base, fixedTime: { startAt: '2026-11-26T13:00', durationMinutes: 120 } }));
    await assert.rejects(tasks.create(U, v.createInput({ ...base, taskName: 'Meeting', fixedTime: { startAt: '2026-11-26T14:00', durationMinutes: 60 } })), (e) => e.status === 409 && e.code === 'appointment_conflict');
    assert.equal((await prisma.task.findMany({ where: {} })).length, 1);
  });
  test('only an explicit edit changes the time; editing other fields leaves it exactly as it was', async () => {
    const { tasks } = fx();
    const t = await tasks.create(U, v.createInput({ ...base, fixedTime: { startAt: '2026-11-26T13:00', durationMinutes: 120 } }));
    const same = await tasks.update(U, t.id, { importance: 'Low', estimatedDurationMinutes: 10, isSplittable: true });
    assert.equal(same.fixedTime.startAt, '2026-11-26T13:00'); assert.equal(same.estimatedDurationMinutes, 120); assert.equal(same.isSplittable, false);
    const moved = await tasks.update(U, t.id, { fixedTime: { startAt: '2026-11-26T16:30', durationMinutes: 30 } });
    assert.deepEqual([moved.fixedTime.startAt, moved.fixedTime.endAt, moved.estimatedDurationMinutes, moved.dueDate], ['2026-11-26T16:30', '2026-11-26T17:00', 30, '2026-11-26']);
  });
  test('cancelling or deleting the task releases its appointment', async () => {
    const { tasks, prisma } = fx();
    const a = await tasks.create(U, v.createInput({ ...base, fixedTime: { startAt: '2026-11-26T13:00', durationMinutes: 60 } }));
    await tasks.setStatus(U, a.id, { status: 'Cancelled' });
    assert.equal((await prisma.appointment.findMany({ where: {} }))[0].status, 'cancelled');
    const b = await tasks.create(U, v.createInput({ ...base, taskName: 'Again', fixedTime: { startAt: '2026-11-26T13:00', durationMinutes: 60 } })); await tasks.remove(U, b.id);
    assert.equal((await prisma.appointment.findMany({ where: {} })).every((x) => x.status === 'cancelled'), true);
  });
  test('existing flexible tasks are untouched: no appointment, isFixedTime false', async () => {
    const { tasks, prisma } = fx(); const t = await tasks.create(U, v.createInput(base));
    assert.equal(t.isFixedTime, false); assert.equal(t.fixedTime, null); assert.equal((await prisma.appointment.findMany({ where: {} })).length, 0);
  });
});
