'use strict';
// Planner service tests. They run the REAL service/engine/validator code against the in-memory Prisma STAND-IN (rollback-capable, no isolation):
// they prove logic, ownership filters, transitions and atomicity of multi-step changes. Real PostgreSQL constraints are checked in test-db/.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryPrisma } = require('../test-support/memoryPrisma');
const { createAppointmentsService } = require('../src/modules/planner/appointments.service');
const { createScheduleService } = require('../src/modules/planner/schedule.service');
const { createPostponeService } = require('../src/modules/planner/postpone.service');
const { createCalendarService } = require('../src/modules/planner/calendar.service');
const { createUsersService } = require('../src/modules/users/users.service');
const v = require('../src/modules/planner/appointments.validator');
const sv = require('../src/modules/planner/schedule.validator');
const { fromWall, toWall, nowWall } = require('../src/modules/planner/wall');

// "now" = 2026-11-25 08:00 in Asia/Kolkata (02:30 UTC). Mutable so tests can move the clock.
let clock; const now = () => new Date(clock);
const IST = (local) => new Date(Date.parse(`${local}:00Z`) - 330 * 60000); // wall-clock in IST -> instant
const A = '00000000-0000-4000-8000-00000000000a'; const B = '00000000-0000-4000-8000-00000000000b';

let db; let appts; let sched; let post; let cal; let mlCalls; let mlMode;
const runsStub = { create: async (userId) => { mlCalls++; if (mlMode === 'fail') throw Object.assign(new Error('down'), { code: 'ml_unavailable' }); const tasks = await db.task.findMany({ where: { userId, status: 'Pending' } }); return { run: { id: `run-${mlCalls}` }, ranked: tasks.sort((a, b) => b.taskName.localeCompare(a.taskName)).map((t, i) => ({ taskId: t.id, rank: i + 1 })) }; } };
const date = (s) => (s ? new Date(`${s}T00:00:00Z`) : null);
const mkTask = (userId, taskName, minutes, extra = {}) => db.task.create({ data: { userId, taskName, importance: 'High', importanceRank: 2, goalContribution: 'High', consequenceOfDelay: 'Major', complexity: 'Moderate', estimatedDurationMinutes: minutes, isSplittable: false, preferredTime: 'Anytime', ...extra, dueDate: date(extra.dueDate), startDate: date(extra.startDate) } });
const code = async (p) => { try { await p; } catch (e) { return e.code ?? e.message; } return 'no-error'; };
const wallBlocks = async (versionId) => (await db.scheduledBlock.findMany({ where: { scheduleVersionId: versionId } })).map((b) => ({ k: b.kind, t: b.taskId, s: toWall(b.startAt), e: toWall(b.endAt) })).sort((x, y) => (x.s < y.s ? -1 : 1));

beforeEach(async () => {
  clock = IST('2026-11-25T08:00'); mlCalls = 0; mlMode = 'ok';
  db = createMemoryPrisma();
  for (const id of [A, B]) { await db.user.create({ data: { id, fullName: id.slice(-1), email: `${id.slice(-1)}@x.io`, passwordHash: 'h' } }); await db.userPreferences.create({ data: { userId: id, timeZone: 'Asia/Kolkata', workDayStart: '09:00', workDayEnd: '18:00', workDays: '0,1,2,3,4,5,6', breaksEnabled: false, breakMinutes: 10, breakAfterMinutes: 90, planningHorizonDays: 3 } }); }
  appts = createAppointmentsService({ prisma: db }); sched = createScheduleService({ prisma: db, runsService: runsStub, now }); post = createPostponeService({ prisma: db, now }); cal = createCalendarService({ prisma: db, now });
});
const doctor = (o = {}) => ({ title: 'Doctor', startAt: '2026-11-25 11:00', endAt: '2026-11-25 13:00', description: null, location: 'Clinic', preparationBufferMinutes: 0, travelBufferMinutes: 0, importance: 'High', consequenceOfDelay: 'Major', ...o });

describe('appointments', () => {
  test('input validation: end after start, max 24h, buffers 0-480', () => {
    assert.throws(() => v.create({ title: 'x', startAt: '2026-11-25 11:00', endAt: '2026-11-25 10:00' }), (e) => e.status === 422);
    assert.throws(() => v.create({ title: 'x', startAt: '2026-11-25 11:00', endAt: '2026-11-26 12:00' }), (e) => e.status === 422);
    assert.throws(() => v.create({ title: 'x', startAt: '2026-11-25 11:00', endAt: '2026-11-25 12:00', travelBufferMinutes: 500 }), (e) => e.status === 422);
    assert.equal(v.create({ title: 'ok', startAt: '2026-11-25 11:00', endAt: '2026-11-25 12:30' }).importance, 'Medium');
  });
  test('create computes duration, writes history; overlap is rejected; duration is derived not stored by the client', async () => {
    const { appointment } = await appts.create(A, v.create(doctor())); assert.equal(appointment.durationMinutes, 120); assert.equal(appointment.startAt, '2026-11-25T11:00');
    assert.equal(await code(appts.create(A, v.create(doctor({ title: 'Clash', startAt: '2026-11-25 12:00', endAt: '2026-11-25 13:30' })))), 'appointment_conflict');
    assert.equal((await appts.history(A, appointment.id)).length, 1);
    await appts.create(B, v.create(doctor())); // another user may have the same slot
  });
  test('reschedule keeps the previous times in history and bumps the revision; stale revision and cancelled edits are rejected', async () => {
    const { appointment } = await appts.create(A, v.create(doctor()));
    const r = await appts.update(A, appointment.id, v.update({ startAt: '2026-11-25 15:00', endAt: '2026-11-25 17:00', revision: 1 })); assert.equal(r.appointment.revision, 2);
    const h = await appts.history(A, appointment.id); assert.equal(h[1].action, 'rescheduled'); assert.equal(h[1].previousStartAt, '2026-11-25T11:00'); assert.equal(h[1].newStartAt, '2026-11-25T15:00');
    assert.equal(await code(appts.update(A, appointment.id, v.update({ title: 'x', revision: 1 }))), 'stale_revision');
    await appts.cancel(A, appointment.id, { reason: 'moved clinic' });
    assert.equal(await code(appts.update(A, appointment.id, v.update({ title: 'again' }))), 'invalid_transition');
    assert.equal(await code(appts.cancel(A, appointment.id, {})), 'invalid_transition');
    assert.equal((await appts.history(A, appointment.id)).at(-1).action, 'cancelled');
  });
  test('another user cannot read, edit, cancel or see history (404)', async () => {
    const { appointment } = await appts.create(A, v.create(doctor()));
    for (const f of [() => appts.get(B, appointment.id), () => appts.update(B, appointment.id, { title: 'h' }), () => appts.cancel(B, appointment.id, {}), () => appts.history(B, appointment.id)]) assert.equal(await code(f()), 'not_found');
    assert.deepEqual(await appts.list(B, {}), []);
  });
  test('unavailable periods: create/list/delete are owner-scoped', async () => {
    const p = await appts.createUnavailable(A, v.unavailable({ label: 'Errand', startAt: '2026-11-25 09:00', endAt: '2026-11-25 10:00' }));
    assert.equal((await appts.listUnavailable(A, { from: '2026-11-25', to: '2026-11-25' })).length, 1); assert.equal((await appts.listUnavailable(B, {})).length, 0);
    assert.equal(await code(appts.removeUnavailable(B, p.id)), 'not_found'); await appts.removeUnavailable(A, p.id);
    assert.throws(() => v.unavailable({ startAt: '2026-11-25 10:00', endAt: '2026-11-25 09:00' }), (e) => e.status === 422);
  });
});

describe('draft generation, approval and rejection', () => {
  const setup = async () => { await appts.create(A, v.create(doctor())); const t1 = await mkTask(A, 'Learn React', 120); const t2 = await mkTask(A, 'WorkToDo project', 180, { isSplittable: true, minimumSessionMinutes: 60 }); const t3 = await mkTask(A, 'Movie', 180); return { t1, t2, t3 }; };

  test('a draft never overlaps the appointment, explains itself and is NOT active until approved', async () => {
    await setup(); const d = await sched.generateDraft(A, {});
    assert.equal(d.schedule.status, 'draft'); assert.equal(await sched.getOpen(A, 'approved'), null);
    for (const b of d.blocks) assert.ok(b.end <= '2026-11-25T11:00' || b.start >= '2026-11-25T13:00', `${b.start}`);
    assert.ok(d.blocks.every((b) => b.reason)); assert.equal(d.schedule.orderSource, 'ml'); assert.equal(d.stale.isStale, false); assert.deepEqual(d.problems.filter((p) => p.severity === 'error'), []);
    assert.ok(Array.isArray(d.unscheduled)); assert.equal(mlCalls, 1, 'exactly one ML call per draft');
  });
  test('ML unavailable: transparent fallback, schedule still produced', async () => {
    await setup(); mlMode = 'fail'; const d = await sched.generateDraft(A, {});
    assert.equal(d.schedule.orderSource, 'fallback'); assert.match(d.notes.ml, /unavailable/); assert.ok(d.blocks.length > 0);
    const off = await sched.generateDraft(A, { useMl: false, replace: true }); assert.equal(off.schedule.orderSource, 'fallback');
  });
  test('only one open draft; replace rejects the old one; approving makes it active', async () => {
    await setup(); const d1 = await sched.generateDraft(A, {});
    assert.equal(await code(sched.generateDraft(A, {})), 'draft_exists');
    const d2 = await sched.generateDraft(A, { replace: true }); assert.notEqual(d1.schedule.id, d2.schedule.id);
    assert.equal((await sched.get(A, d1.schedule.id)).schedule.status, 'rejected');
    const ap = await sched.approve(A, d2.schedule.id, { revision: d2.schedule.revision }); assert.equal(ap.schedule.status, 'approved');
    assert.equal((await sched.getOpen(A, 'approved')).schedule.id, d2.schedule.id); assert.equal(await sched.getOpen(A, 'draft'), null);
  });
  test('rejecting a draft leaves the approved schedule completely unchanged', async () => {
    await setup(); const d1 = await sched.generateDraft(A, {}); await sched.approve(A, d1.schedule.id, {});
    const before = await wallBlocks(d1.schedule.id);
    const d2 = await sched.generateDraft(A, { mode: 'fresh' }); await sched.reject(A, d2.schedule.id);
    assert.deepEqual(await wallBlocks(d1.schedule.id), before); assert.equal((await sched.getOpen(A, 'approved')).schedule.id, d1.schedule.id); assert.equal(await sched.getOpen(A, 'draft'), null);
    assert.equal(await code(sched.reject(A, d2.schedule.id)), 'invalid_transition'); assert.equal(await code(sched.approve(A, d2.schedule.id, {})), 'invalid_transition');
  });
  test('approving a new draft supersedes (keeps) the previous version; history lists every version', async () => {
    await setup(); const d1 = await sched.generateDraft(A, {}); await sched.approve(A, d1.schedule.id, {});
    const d2 = await sched.generateDraft(A, { mode: 'fresh' }); await sched.approve(A, d2.schedule.id, {});
    assert.equal((await sched.get(A, d1.schedule.id)).schedule.status, 'superseded'); assert.ok((await sched.get(A, d1.schedule.id)).blocks.length > 0);
    assert.deepEqual((await sched.list(A)).map((x) => [x.versionNumber, x.status]), [[2, 'approved'], [1, 'superseded']]);
  });
  test('stale draft: changing an appointment, task or availability after generation blocks approval; the approved schedule is untouched', async () => {
    await setup(); const d1 = await sched.generateDraft(A, {}); await sched.approve(A, d1.schedule.id, {});
    const d2 = await sched.generateDraft(A, { mode: 'fresh' });
    await appts.create(A, v.create({ title: 'New meeting', startAt: '2026-11-25 15:00', endAt: '2026-11-25 16:00' }));
    const shown = await sched.get(A, d2.schedule.id); assert.deepEqual(shown.stale, { isStale: true, changed: ['appointments'] });
    assert.equal(await code(sched.approve(A, d2.schedule.id, {})), 'draft_stale'); assert.equal((await sched.getOpen(A, 'approved')).schedule.id, d1.schedule.id);
    const d3 = await sched.generateDraft(A, { replace: true, mode: 'fresh' }); await mkTask(A, 'Late task', 30); assert.equal(await code(sched.approve(A, d3.schedule.id, {})), 'draft_stale');
  });
  test('stale revision and double/concurrent approval: exactly one wins', async () => {
    await setup(); const d = await sched.generateDraft(A, {});
    assert.equal(await code(sched.approve(A, d.schedule.id, { revision: 99 })), 'stale_revision');
    const results = await Promise.all([sched.approve(A, d.schedule.id, {}).then(() => 'ok', (e) => e.code), sched.approve(A, d.schedule.id, {}).then(() => 'ok', (e) => e.code)]);
    assert.equal(results.filter((r) => r === 'ok').length, 1); assert.equal(await db.scheduleVersion.count({ where: { userId: A, status: 'approved' } }), 1);
  });
  test('a failure in the middle of approval rolls everything back (previous approved stays approved)', async () => {
    await setup(); const d1 = await sched.generateDraft(A, {}); await sched.approve(A, d1.schedule.id, {}); const d2 = await sched.generateDraft(A, { mode: 'fresh' });
    const real = db.scheduleVersion.updateMany; let calls = 0;
    db.scheduleVersion.updateMany = async (a) => { const r = await real(a); if (a.data.status === 'approved') { calls++; throw Object.assign(new Error('simulated crash'), { code: 'EBOOM' }); } return r; };
    assert.equal(await code(sched.approve(A, d2.schedule.id, {})), 'EBOOM'); db.scheduleVersion.updateMany = real;
    assert.equal(calls, 1); assert.equal((await sched.get(A, d1.schedule.id)).schedule.status, 'approved'); assert.equal((await sched.get(A, d2.schedule.id)).schedule.status, 'draft');
  });
  test('ownership: another user cannot read, edit, approve, reject or diff my schedules', async () => {
    await setup(); const d = await sched.generateDraft(A, {}); const b = d.blocks[0];
    for (const f of [() => sched.get(B, d.schedule.id), () => sched.approve(B, d.schedule.id, {}), () => sched.reject(B, d.schedule.id), () => sched.diff(B, d.schedule.id), () => sched.moveBlock(B, d.schedule.id, b.id, { start: '2026-11-25T14:00' }), () => sched.removeBlock(B, d.schedule.id, b.id), () => sched.addBreak(B, d.schedule.id, { start: '2026-11-25T14:00', end: '2026-11-25T14:10' })]) assert.equal(await code(f()), 'not_found');
    assert.equal(await sched.getOpen(B, 'draft'), null); assert.deepEqual(await sched.list(B), []);
  });
});

describe('re-planning keeps what is valid and never moves appointments', () => {
  test('a new appointment that collides with an approved session moves ONLY that session', async () => {
    const t1 = await mkTask(A, 'Alpha', 60); const t2 = await mkTask(A, 'Beta', 60); const t3 = await mkTask(A, 'Gamma', 60);
    const d1 = await sched.generateDraft(A, { useMl: false }); await sched.approve(A, d1.schedule.id, {}); const original = await wallBlocks(d1.schedule.id);
    const victim = original.find((b) => b.k === 'task'); const others = original.filter((b) => b !== victim);
    const { impact } = await appts.create(A, v.create({ title: 'Surprise', startAt: victim.s.replace('T', ' '), endAt: victim.e.replace('T', ' ') })); assert.equal(impact.approvedBlocks, 1); assert.equal(impact.recalculationSuggested, true);
    assert.equal((await sched.getOpen(A, 'approved')).needsRecalculation, true, 'approved schedule is reported, not silently rewritten');
    assert.deepEqual(await wallBlocks(d1.schedule.id), original);
    const d2 = await sched.generateDraft(A, { useMl: false }); const next = await wallBlocks(d2.schedule.id);
    for (const o of others) assert.ok(next.some((n) => n.t === o.t && n.s === o.s && n.e === o.e), 'unaffected session kept in place');
    assert.ok(next.every((n) => n.e <= victim.s || n.s >= victim.e), 'nothing overlaps the new appointment'); assert.equal(next.filter((n) => n.k === 'task').length, 3);
    assert.equal(d2.blocks.filter((b) => b.source === 'kept').length, 2); assert.equal(d2.schedule.basedOnId, d1.schedule.id);
  });
  test('cancelling an appointment releases its time for an unscheduled task', async () => {
    const { appointment } = await appts.create(A, v.create({ title: 'All day', startAt: '2026-11-25 09:00', endAt: '2026-11-25 18:00' })); const t = await mkTask(A, 'Needs time', 600, { dueDate: '2026-11-25', isSplittable: true, minimumSessionMinutes: 30 });
    const d1 = await sched.generateDraft(A, { useMl: false }); assert.equal(d1.unscheduled.length, 1); assert.equal(d1.unscheduled[0].taskId, t.id);
    await sched.reject(A, d1.schedule.id); await appts.cancel(A, appointment.id, {});
    const t2 = await mkTask(A, 'Fits now', 120); const d2 = await sched.generateDraft(A, { useMl: false }); assert.ok(d2.blocks.some((b) => b.taskId === t2.id && b.start === '2026-11-25T09:00'));
  });
  test('rescheduled appointment: the old time is released and the new time protected', async () => {
    const { appointment } = await appts.create(A, v.create(doctor())); await mkTask(A, 'Study', 120);
    await appts.update(A, appointment.id, v.update({ startAt: '2026-11-25 15:00', endAt: '2026-11-25 17:00' }));
    const d = await sched.generateDraft(A, { useMl: false }); assert.ok(d.blocks.every((b) => b.end <= '2026-11-25T15:00' || b.start >= '2026-11-25T17:00')); assert.equal(d.blocks[0].start, '2026-11-25T09:00'); assert.equal(d.appointments[0].startAt, '2026-11-25T15:00');
  });
  test('a task that overran: recorded actual time reduces the remainder and its stale sessions are re-planned; completed work is preserved', async () => {
    const t = await mkTask(A, 'Overran', 120, { isSplittable: true, minimumSessionMinutes: 30 }); const other = await mkTask(A, 'Other', 60);
    const d1 = await sched.generateDraft(A, { useMl: false }); await sched.approve(A, d1.schedule.id, {});
    clock = IST('2026-11-25T10:00'); // 2h later; the user actually worked 90 minutes on it
    await db.focusTimer.create({ data: { userId: A, taskId: t.id, taskNameSnapshot: t.taskName, status: 'finished', plannedDurationMinutes: 60, startedAt: IST('2026-11-25T09:00'), endedAt: IST('2026-11-25T10:30'), actualFocusedSeconds: 5400, totalPausedSeconds: 0 } });
    const d2 = await sched.generateDraft(A, { useMl: false }); const mine = d2.blocks.filter((b) => b.taskId === t.id).reduce((s, b) => s + b.durationMinutes, 0);
    assert.equal(mine, 30, 'only the remaining 30 of 120 minutes is scheduled'); assert.equal(d2.taskSummaries.find((s) => s.taskId === t.id).completedMinutes, 90);
    assert.equal(await db.focusTimer.count({ where: { userId: A, status: 'finished' } }), 1, 'actual session history untouched'); assert.ok(d2.blocks.every((b) => b.start >= '2026-11-25T10:00'));
  });
  test('completed tasks and tasks with a future start date are handled (never scheduled early / again)', async () => {
    await mkTask(A, 'Done', 60, { status: 'Completed' }); const f = await mkTask(A, 'Future', 60, { startDate: '2026-11-29' });
    const d = await sched.generateDraft(A, { useMl: false }); assert.equal(d.blocks.length, 0); assert.equal(d.unscheduled[0].code, 'starts_after_horizon');
    await sched.reject(A, d.schedule.id); const wide = await db.userPreferences.updateMany({ where: { userId: A }, data: { planningHorizonDays: 5 } }); void wide;
    const d2 = await sched.generateDraft(A, { useMl: false }); assert.equal(d2.blocks.find((b) => b.taskId === f.id).start.slice(0, 10), '2026-11-29');
  });
});

describe('editing a draft: moves, breaks, conflicts (validated on the backend)', () => {
  const draftWith = async () => { await appts.create(A, v.create(doctor())); const a = await mkTask(A, 'Alpha', 60); const b = await mkTask(A, 'Beta', 60); const d = await sched.generateDraft(A, { useMl: false }); return { a, b, d }; };
  test('a valid move is saved with a bumped revision; a preview does not write', async () => {
    const { d } = await draftWith(); const blk = d.blocks.find((x) => x.kind === 'task');
    const p = await sched.moveBlock(A, d.schedule.id, blk.id, { start: '2026-11-25T15:00', preview: true }); assert.equal(p.valid, true);
    assert.equal((await db.scheduledBlock.findFirst({ where: { id: blk.id } })).startAt.getTime(), fromWall(blk.start).getTime());
    const m = await sched.moveBlock(A, d.schedule.id, blk.id, { start: '2026-11-25T15:00', revision: d.schedule.revision }); assert.equal(m.schedule.revision, d.schedule.revision + 1); assert.equal(m.blocks.find((x) => x.id === blk.id).start, '2026-11-25T15:00'); assert.equal(m.blocks.find((x) => x.id === blk.id).source, 'user');
    assert.equal(await code(sched.moveBlock(A, d.schedule.id, blk.id, { start: '2026-11-25T16:00', revision: d.schedule.revision })), 'stale_revision');
  });
  test('moves that violate a constraint are rejected and nothing is saved', async () => {
    const { d } = await draftWith(); const blk = d.blocks.find((x) => x.kind === 'task'); const orig = await wallBlocks(d.schedule.id);
    for (const [start, why] of [['2026-11-25T11:30', 'appointment'], ['2026-11-25T18:00', 'working hours'], ['2026-11-25T07:00', 'past / outside hours'], ['2026-11-25T10:30', 'overlaps appointment buffer-free start 11:00 (10:30-11:30)']]) {
      assert.equal(await code(sched.moveBlock(A, d.schedule.id, blk.id, { start })), 'schedule_conflict', why);
    }
    const other = d.blocks.filter((x) => x.kind === 'task')[1]; assert.equal(await code(sched.moveBlock(A, d.schedule.id, blk.id, { start: other.start })), 'schedule_conflict');
    assert.deepEqual(await wallBlocks(d.schedule.id), orig);
  });
  test('moving a dependent before its prerequisite is rejected', async () => {
    const pre = await mkTask(A, 'Pre', 60); const dep = await mkTask(A, 'Dep', 60); await db.taskDependency.create({ data: { userId: A, taskId: dep.id, dependsOnTaskId: pre.id } });
    const d = await sched.generateDraft(A, { useMl: false }); const bd = d.blocks.find((x) => x.taskId === dep.id); const bp = d.blocks.find((x) => x.taskId === pre.id); assert.ok(bd.start >= bp.end);
    assert.equal(await code(sched.moveBlock(A, d.schedule.id, bd.id, { start: '2026-11-25T08:00' })), 'schedule_conflict');
    const late = await sched.moveBlock(A, d.schedule.id, bd.id, { start: '2026-11-25T16:00' }); assert.equal(late.valid, true);
  });
  test('only drafts are editable; the approved schedule can be copied into a draft for editing', async () => {
    const { d } = await draftWith(); await sched.approve(A, d.schedule.id, {}); const blk = d.blocks.find((x) => x.kind === 'task');
    assert.equal(await code(sched.moveBlock(A, d.schedule.id, blk.id, { start: '2026-11-25T15:00' })), 'invalid_transition'); assert.equal(await code(sched.removeBlock(A, d.schedule.id, blk.id)), 'invalid_transition');
    const clone = await sched.generateDraft(A, { mode: 'clone' }); assert.equal(clone.blocks.length, d.blocks.length); assert.equal(mlCalls, 0, 'clone makes no ML call'); assert.deepEqual(clone.blocks.map((x) => [x.start, x.end]), d.blocks.map((x) => [x.start, x.end]));
  });
  test('breaks: manual add, overlap needs confirmation, re-plan moves only displaced sessions, remove/accept', async () => {
    const { d } = await draftWith(); const tasks = d.blocks.filter((x) => x.kind === 'task'); const first = tasks[0];
    const free = await sched.addBreak(A, d.schedule.id, { start: '2026-11-25T17:00', end: '2026-11-25T17:15' }); assert.ok(free.blocks.some((b) => b.kind === 'break' && b.start === '2026-11-25T17:00' && b.status === 'accepted'));
    assert.equal(await code(sched.addBreak(A, d.schedule.id, { start: first.start, end: first.end })), 'break_conflict');
    const r = await sched.addBreak(A, d.schedule.id, { start: first.start, end: toWall(new Date(fromWall(first.start).getTime() + 30 * 60000)), replan: true });
    assert.deepEqual(r.replanned, [first.taskId]); const tb = r.blocks.filter((b) => b.taskId === first.taskId); assert.equal(tb.reduce((s, b) => s + b.durationMinutes, 0), 60);
    assert.deepEqual(r.problems.filter((p) => p.severity === 'error'), []); const br = r.blocks.find((b) => b.kind === 'break' && b.start === first.start); assert.ok(br);
    const gone = await sched.removeBlock(A, d.schedule.id, br.id); assert.ok(!gone.blocks.some((b) => b.id === br.id));
    assert.equal(await code(sched.addBreak(A, d.schedule.id, { start: '2026-11-25T19:00', end: '2026-11-25T19:10' })), 'schedule_conflict');
  });
  test('automatic breaks are suggested after continuous work and can be accepted', async () => {
    await db.userPreferences.updateMany({ where: { userId: A }, data: { breaksEnabled: true, breakAfterMinutes: 60, breakMinutes: 15 } }); await mkTask(A, 'Long', 180, { isSplittable: true, minimumSessionMinutes: 30 });
    const d = await sched.generateDraft(A, { useMl: false }); const brk = d.blocks.filter((b) => b.kind === 'break'); assert.ok(brk.length >= 1); assert.equal(brk[0].status, 'suggested'); assert.equal(brk[0].durationMinutes, 15);
    const acc = await sched.acceptBreak(A, d.schedule.id, brk[0].id); assert.equal(acc.blocks.find((b) => b.id === brk[0].id).status, 'accepted'); assert.deepEqual(acc.problems.filter((p) => p.severity === 'error'), []);
  });
  test('diff shows what approving would change; skip marks a session without rewriting the plan', async () => {
    const d0 = await draftWith(); const d = await sched.generateDraft(A, { replace: true, useMl: false }); void d0; await sched.approve(A, d.schedule.id, {}); const d2 = await sched.generateDraft(A, { mode: 'fresh', useMl: false }); const blk = d2.blocks.find((x) => x.kind === 'task');
    await sched.moveBlock(A, d2.schedule.id, blk.id, { start: '2026-11-25T15:00' }); const df = await sched.diff(A, d2.schedule.id); assert.equal(df.added.length, 1); assert.equal(df.removed.length, 1);
    const ap = (await sched.getOpen(A, 'approved')); const target = ap.blocks.find((x) => x.kind === 'task');
    const sk = await sched.skipBlock(A, ap.schedule.id, target.id); assert.equal(sk.blocks.find((x) => x.id === target.id).status, 'skipped'); assert.equal(await code(sched.skipBlock(A, ap.schedule.id, target.id)), 'invalid_transition');
  });
});

describe('postponement', () => {
  test('postpones by one day, keeps the original deadline, records history and counts', async () => {
    const t = await mkTask(A, 'Report', 60, { dueDate: '2026-11-30' });
    const r = await post.postpone(A, t.id, { days: 1, reason: 'sick' }); assert.equal(r.task.postponedUntil, '2026-11-26'); assert.equal(r.task.dueDate, '2026-11-30'); assert.equal(r.needsRecalculation, true);
    const r2 = await post.postpone(A, t.id, {}); assert.equal(r2.task.postponedUntil, '2026-11-27'); assert.equal(r2.task.postponeCount, 2);
    const h = await post.history(A, t.id); assert.equal(h.postponeCount, 2); assert.equal(h.history.length, 2); assert.equal(h.history[1].reason, 'sick'); assert.equal(h.history[0].previousPostponedUntil, '2026-11-26'); assert.equal(h.history[0].originalDueDate, '2026-11-30');
    assert.equal((await db.task.findFirst({ where: { id: t.id } })).dueDate.toISOString().slice(0, 10), '2026-11-30');
  });
  test('going past the deadline requires confirmation; completed/other users/missing tasks are refused', async () => {
    const t = await mkTask(A, 'Due today', 60, { dueDate: '2026-11-25' });
    assert.equal(await code(post.postpone(A, t.id, {})), 'confirmation_required'); assert.equal((await db.task.findFirst({ where: { id: t.id } })).postponeCount, 0);
    const ok = await post.postpone(A, t.id, { confirm: true }); assert.equal(ok.pastDeadline, true);
    assert.equal(await code(post.postpone(B, t.id, { confirm: true })), 'not_found'); assert.equal(await code(post.history(B, t.id)), 'not_found');
    const done = await mkTask(A, 'Done', 10, { status: 'Completed' }); assert.equal(await code(post.postpone(A, done.id, {})), 'invalid_transition');
  });
  test('a postponed task is not scheduled before its new date and the approved plan is flagged for recalculation', async () => {
    const t = await mkTask(A, 'Later', 60); const d = await sched.generateDraft(A, { useMl: false }); await sched.approve(A, d.schedule.id, {}); assert.equal(d.blocks[0].start.slice(0, 10), '2026-11-25');
    await post.postpone(A, t.id, { days: 2 }); assert.equal((await sched.getOpen(A, 'approved')).needsRecalculation, true);
    const d2 = await sched.generateDraft(A, { useMl: false }); assert.equal(d2.blocks.find((b) => b.taskId === t.id).start.slice(0, 10), '2026-11-27');
  });
});

describe('calendar read model and preferences', () => {
  test('returns days with working window, free/planned minutes, appointments, deadlines; range limited; owner-scoped', async () => {
    await appts.create(A, v.create(doctor())); await appts.create(B, v.create(doctor({ title: 'Secret' }))); await mkTask(A, 'Due', 30, { dueDate: '2026-11-26' });
    const d = await sched.generateDraft(A, { useMl: false }); await sched.approve(A, d.schedule.id, {});
    const c = await cal.range(A, { from: '2026-11-25', to: '2026-11-27' }); assert.equal(c.days.length, 3); assert.equal(c.today, '2026-11-25'); assert.equal(c.timeZone, 'Asia/Kolkata');
    assert.equal(c.appointments.length, 1); assert.equal(c.appointments[0].title, 'Doctor'); assert.equal(c.deadlines[0].dueDate, '2026-11-26'); assert.ok(c.days[0].plannedMinutes > 0); assert.ok(c.days[0].freeMinutes >= 0); assert.equal(c.hasApproved, true);
    assert.ok(!JSON.stringify(c).includes('Secret'));
    assert.throws(() => sv.calendarQuery({ from: '2026-11-01', to: '2027-01-30' }), (e) => e.status === 422); assert.throws(() => sv.calendarQuery({ from: '2026-11-05' }), (e) => e.status === 422);
  });
  test('working-hour preferences are validated and respected (a day off gets no work)', async () => {
    const users = createUsersService({ prisma: db });
    assert.equal(await code(users.updatePreferences(A, require('../src/modules/users/users.validator').preferencesInput({ workDayStart: '18:00', workDayEnd: '09:00' }))), 'validation_error');
    assert.throws(() => require('../src/modules/users/users.validator').preferencesInput({ workDays: [1, 9] }), (e) => e.status === 422);
    const saved = await users.updatePreferences(A, require('../src/modules/users/users.validator').preferencesInput({ workDayStart: '10:00', workDayEnd: '12:00', workDays: [3] })); assert.deepEqual(saved.workDays, [3]);
    await mkTask(A, 'Two hours', 120); const d = await sched.generateDraft(A, { useMl: false }); assert.deepEqual(d.blocks.map((b) => [b.start, b.end]), [['2026-11-25T10:00', '2026-11-25T12:00']]);
  });
});

describe('time zone handling', () => {
  test('Asia/Kolkata midnight boundary and a non-DST zone resolve the right local date; unknown zones fall back', () => {
    assert.equal(nowWall(new Date('2026-11-24T18:29:00Z'), 'Asia/Kolkata'), '2026-11-24T23:59'); assert.equal(nowWall(new Date('2026-11-24T18:30:00Z'), 'Asia/Kolkata'), '2026-11-25T00:00');
    assert.equal(nowWall(new Date('2026-11-24T18:30:00Z'), 'Not/AZone'), '2026-11-25T00:00'); assert.equal(nowWall(new Date('2026-11-24T18:30:00Z'), 'Asia/Tokyo'), '2026-11-25T03:30');
  });
  test('a user whose zone is UTC gets a UTC "today" (the old bug) while an IST user gets the IST date', async () => {
    clock = new Date('2026-11-24T21:49:07Z'); await db.userPreferences.updateMany({ where: { userId: B }, data: { timeZone: 'UTC' } });
    assert.equal(await cal.today(A), '2026-11-25'); assert.equal(await cal.today(B), '2026-11-24');
  });
});
