'use strict';
// Focus-timer tests. Part 1 (pure maths) uses no stand-ins. Part 2 runs the REAL service logic against the in-memory Prisma
// STAND-IN (test-support/memoryPrisma.js): it proves lifecycle/guard/ownership logic, not Prisma or PostgreSQL behaviour
// (partial unique indexes, CHECK constraints and transactions are exercised by test-db/ and by the migration SQL checks).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeElapsed, TRANSITIONS } = require('../src/modules/timer/timer.calc');
const { createTimerService } = require('../src/modules/timer/timer.service');
const { createMemoryPrisma } = require('../test-support/memoryPrisma');
const { AppError } = require('../src/errors/AppError');
const v = require('../src/modules/timer/timer.validator');

const T0 = Date.parse('2026-11-24T10:00:00.000Z');
const at = (sec) => new Date(T0 + sec * 1000);

describe('computeElapsed (pure)', () => {
  const timer = { startedAt: at(0), endedAt: null };
  test('no pauses: focused equals wall time', () => assert.deepEqual(computeElapsed(timer, [], at(600)), { focusedSeconds: 600, pausedSeconds: 0, wallSeconds: 600 }));
  test('closed pause is excluded', () => assert.equal(computeElapsed(timer, [{ pausedAt: at(100), resumedAt: at(160) }], at(600)).focusedSeconds, 540));
  test('open pause runs until now, so a paused timer does not keep counting after a refresh', () => {
    const p = [{ pausedAt: at(100), resumedAt: null }];
    assert.equal(computeElapsed(timer, p, at(100)).focusedSeconds, 100);
    assert.equal(computeElapsed(timer, p, at(5000)).focusedSeconds, 100);
    assert.equal(computeElapsed(timer, p, at(5000)).pausedSeconds, 4900);
  });
  test('several pauses add up', () => assert.equal(computeElapsed(timer, [{ pausedAt: at(60), resumedAt: at(90) }, { pausedAt: at(200), resumedAt: at(260) }, { pausedAt: at(400), resumedAt: null }], at(500)).focusedSeconds, 500 - 30 - 60 - 100));
  test('ended timers are frozen at endedAt regardless of the evaluation instant', () => {
    const done = { startedAt: at(0), endedAt: at(300) };
    assert.equal(computeElapsed(done, [], at(99999)).focusedSeconds, 300);
  });
  test('whole seconds are floored; pauses outside the window and clock skew never produce negatives', () => {
    assert.equal(computeElapsed({ startedAt: at(0) }, [], new Date(T0 + 1999)).focusedSeconds, 1);
    assert.equal(computeElapsed({ startedAt: at(100) }, [{ pausedAt: at(0), resumedAt: at(50) }], at(50)).focusedSeconds, 0);
    assert.equal(computeElapsed({ startedAt: at(100) }, [], at(50)).focusedSeconds, 0);
  });
  test('transition table', () => {
    assert.deepEqual(TRANSITIONS.pause.from, ['running']); assert.deepEqual(TRANSITIONS.resume.from, ['paused']);
    assert.deepEqual(TRANSITIONS.finish.from, ['running', 'paused']); assert.deepEqual(TRANSITIONS.cancel.from, ['running', 'paused']);
  });
});

const code = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof AppError, String(e && e.stack)); return `${e.status}:${e.code}`; } return 'no-error'; };
function fixture() {
  const prisma = createMemoryPrisma(); const clock = { t: T0 };
  const service = createTimerService({ prisma, now: () => new Date(clock.t) });
  const user = (id) => prisma._tables.user.push({ id, email: `${id}@x`, isActive: true });
  const task = (userId, extra = {}) => { const row = { id: crypto.randomUUID(), userId, taskName: 'Write', estimatedDurationMinutes: 45, status: 'Pending', deletedAt: null, ...extra }; prisma._tables.task = prisma._tables.task ?? []; prisma._tables.task.push(row); return row; };
  return { prisma, service, clock, task, user, tick: (s) => { clock.t += s * 1000; } };
}
const A = '00000000-0000-4000-8000-00000000000a'; const B = '00000000-0000-4000-8000-00000000000b';

describe('focus timer lifecycle (service logic, stand-in Prisma)', () => {
  test('start -> pause -> resume -> finish records pause intervals and exact actual duration', async () => {
    const { service, tick, prisma } = fixture();
    const s = await service.start(A, { plannedDurationMinutes: 25 });
    assert.equal(s.status, 'running'); assert.equal(s.plannedSeconds, 1500); assert.equal(s.elapsedSeconds, 0); assert.equal(s.remainingSeconds, 1500);
    tick(300); let p = await service.pause(A, s.id); assert.equal(p.status, 'paused'); assert.equal(p.elapsedSeconds, 300); assert.equal(p.pauses.length, 1); assert.equal(p.pauses[0].resumedAt, null);
    tick(120); const mid = await service.active(A); assert.equal(mid.elapsedSeconds, 300, 'a paused timer does not advance (e.g. after a browser refresh)'); assert.equal(mid.pausedSeconds, 120);
    const r = await service.resume(A, s.id); assert.equal(r.status, 'running'); assert.ok(r.pauses[0].resumedAt);
    tick(200); const f = await service.finish(A, s.id, {});
    assert.equal(f.status, 'finished'); assert.equal(f.elapsedSeconds, 500); assert.equal(f.pausedSeconds, 120); assert.equal(f.plannedSeconds, 1500); assert.equal(f.remainingSeconds, 1000);
    const row = prisma._tables.focusTimer[0]; assert.equal(row.actualFocusedSeconds, 500); assert.equal(row.totalPausedSeconds, 120); assert.ok(row.endedAt);
    tick(9999); assert.equal((await service.get(A, s.id)).elapsedSeconds, 500, 'finished timers are frozen');
  });
  test('finishing while paused closes the open pause at the end instant', async () => {
    const { service, tick, prisma } = fixture(); const s = await service.start(A, {});
    tick(100); await service.pause(A, s.id); tick(50); const f = await service.finish(A, s.id, {});
    assert.equal(f.elapsedSeconds, 100); assert.equal(f.pausedSeconds, 50); assert.ok(prisma._tables.focusTimerPause.every((p) => p.resumedAt));
  });
  test('overtime is reported separately from planned duration', async () => {
    const { service, tick } = fixture(); const s = await service.start(A, { plannedDurationMinutes: 1 });
    tick(90); const t = await service.get(A, s.id); assert.equal(t.isOvertime, true); assert.equal(t.remainingSeconds, 0); assert.equal(t.overtimeSeconds, 30); assert.equal(t.elapsedSeconds, 90);
  });
  test('cancel stores actual time but is not counted as finished', async () => {
    const { service, tick, prisma } = fixture(); const s = await service.start(A, {}); tick(40); const c = await service.cancel(A, s.id);
    assert.equal(c.status, 'cancelled'); assert.equal(prisma._tables.focusTimer[0].actualFocusedSeconds, 40); assert.equal(await service.active(A), null);
  });
  test('invalid transitions are rejected (409) and change nothing', async () => {
    const { service, tick, prisma } = fixture(); const s = await service.start(A, {});
    assert.equal(await code(service.resume(A, s.id)), '409:invalid_transition'); // not paused
    tick(10); await service.pause(A, s.id); tick(5);
    assert.equal(await code(service.pause(A, s.id)), '409:invalid_transition'); // already paused (duplicate request)
    await service.finish(A, s.id, {});
    for (const act of ['finish', 'pause', 'resume', 'cancel']) assert.equal(await code(service[act](A, s.id, {})), '409:invalid_transition', act);
    assert.equal(prisma._tables.focusTimer[0].actualFocusedSeconds, 10); assert.equal(prisma._tables.focusTimerPause.length, 1);
  });
  test('only one active timer per user; a second start is a 409, other users are unaffected; a new one is allowed after finishing', async () => {
    const { service } = fixture(); const first = await service.start(A, {});
    assert.equal(await code(service.start(A, {})), '409:timer_already_active');
    assert.ok(await service.start(B, {}));
    await service.finish(A, first.id, {}); assert.ok(await service.start(A, {}));
  });
  test('concurrent start loses the race to the unique index and still returns 409 (not 500)', async () => {
    const { service, prisma } = fixture();
    const realCreate = prisma.focusTimer.create; let raced = false;
    prisma.focusTimer.create = async (args) => { if (!raced) { raced = true; await realCreate({ data: { userId: A, status: 'running', plannedDurationMinutes: 5, startedAt: new Date(T0) } }); } return realCreate(args); };
    assert.equal(await code(service.start(A, {})), '409:timer_already_active');
  });
  test('cross-user access is a 404 for every action', async () => {
    const { service } = fixture(); const s = await service.start(A, {});
    for (const act of ['get', 'pause', 'resume', 'finish', 'cancel']) assert.equal(await code(service[act](B, s.id, {})), '404:not_found', act);
    assert.equal((await service.history(B, { page: 1, pageSize: 10 })).total, 0);
  });
  test('task association: ownership, active-only, snapshot, default planned duration, Pending -> In Progress; completeTask on finish', async () => {
    const { service, task, prisma, tick } = fixture(); const mine = task(A); const theirs = task(B); const done = task(A, { status: 'Completed' }); const gone = task(A, { deletedAt: new Date() });
    assert.equal(await code(service.start(A, { taskId: theirs.id })), '404:not_found');
    assert.equal(await code(service.start(A, { taskId: gone.id })), '404:not_found');
    assert.equal(await code(service.start(A, { taskId: done.id })), '422:task_not_active');
    const s = await service.start(A, { taskId: mine.id }); assert.equal(s.taskName, 'Write'); assert.equal(s.plannedDurationMinutes, 45); assert.equal(mine.status, 'In Progress');
    tick(60); await service.finish(A, s.id, { completeTask: true }); assert.equal(mine.status, 'Completed'); assert.ok(mine.completedAt);
    assert.equal(prisma._tables.focusTimer[0].taskNameSnapshot, 'Write');
    assert.equal((await service.history(A, { page: 1, pageSize: 10, taskId: mine.id })).total, 1);
  });
  test('history lists only ended timers, newest first, with pagination', async () => {
    const { service, tick } = fixture();
    for (let i = 0; i < 3; i++) { const s = await service.start(A, { plannedDurationMinutes: 10 + i }); tick(30); await service.finish(A, s.id, {}); tick(5); }
    const live = await service.start(A, {}); const h = await service.history(A, { page: 1, pageSize: 2 });
    assert.equal(h.total, 3); assert.equal(h.items.length, 2); assert.equal(h.totalPages, 2); assert.equal(h.items[0].plannedDurationMinutes, 12); assert.ok(!h.items.some((t) => t.id === live.id));
  });
  test('validation: ids, planned duration bounds, unknown fields', () => {
    assert.throws(() => v.startInput({ plannedDurationMinutes: 0 }), (e) => e.status === 422);
    assert.throws(() => v.startInput({ plannedDurationMinutes: 721 }), (e) => e.status === 422);
    assert.throws(() => v.startInput({ taskId: 'nope' }), (e) => e.status === 422);
    assert.throws(() => v.startInput({ startedAt: '2020-01-01' }), (e) => e.status === 422); // clients cannot choose timestamps
    assert.throws(() => v.noBody({ elapsed: 1 }), (e) => e.status === 422);
    assert.deepEqual(v.startInput({}), { taskId: null, focusSessionId: null, plannedDurationMinutes: undefined });
  });
});
