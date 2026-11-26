'use strict';
// One authoritative draft: the same ordered timeline for the Recommendations page and the Planner; updated drafts after changes; nothing auto-approved.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryPrisma } = require('../test-support/memoryPrisma');
const { createAppointmentsService } = require('../src/modules/planner/appointments.service');
const { createScheduleService } = require('../src/modules/planner/schedule.service');
const { createTasksService } = require('../src/modules/tasks/tasks.service');
const { createDependenciesService } = require('../src/modules/tasks/dependencies');
const tv = require('../src/modules/tasks/tasks.validator');
const sv = require('../src/modules/planner/schedule.validator');

let clock; const now = () => new Date(clock);
const IST = (local) => new Date(Date.parse(`${local}:00Z`) - 330 * 60000);
const U = '00000000-0000-4000-8000-00000000000a';
let db; let appts; let sched; let tasks; let deps; let sessions;
const runsStub = { create: async (userId, session) => { sessions.push(session); const rows = await db.task.findMany({ where: { userId, status: 'Pending' } }); return { run: { id: `run-${sessions.length}` }, ranked: rows.map((t, i) => ({ taskId: t.id, rank: i + 1 })) }; } };
const mk = (name, minutes, extra = {}) => tasks.create(U, tv.createInput({ taskName: name, importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Major', estimatedDurationMinutes: minutes, ...extra }));
const sig = (d) => JSON.stringify(d.timeline.map((x) => [x.kind, x.title, x.start, x.end, x.sessionIndex, x.sessionCount]));

beforeEach(async () => {
  clock = IST('2026-11-26T11:22'); sessions = []; db = createMemoryPrisma();
  await db.user.create({ data: { id: U, fullName: 'A', email: 'a@x.io', passwordHash: 'h' } });
  await db.userPreferences.create({ data: { userId: U, timeZone: 'Asia/Kolkata', workDayStart: '09:00', workDayEnd: '18:00', workDays: '0,1,2,3,4,5,6', breaksEnabled: false, breakMinutes: 10, breakAfterMinutes: 90, planningHorizonDays: 2 } });
  appts = createAppointmentsService({ prisma: db }); tasks = createTasksService({ prisma: db, now, appointments: appts }); deps = createDependenciesService({ prisma: db });
  sched = createScheduleService({ prisma: db, runsService: runsStub, now });
});

describe('the shared draft', () => {
  test('one draft holds task sessions AND the fixed appointment in time order, every item with an exact start and end', async () => {
    await mk('Dentist Appointment', 120, { fixedTime: { startAt: '2026-11-26T13:00', durationMinutes: 120 } });
    await mk('Reply to manager', 15); await mk('API integration', 60); await mk('Study OS', 60);
    const d = await sched.generateDraft(U, { mode: 'fresh', replace: true });
    assert.equal(d.schedule.status, 'draft'); assert.ok(d.timeline.length >= 4);
    for (const x of d.timeline) { assert.match(x.start, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/); assert.match(x.end, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/); assert.ok(x.end > x.start); }
    const order = d.timeline.map((x) => x.start); assert.deepEqual(order, [...order].sort());
    const dent = d.timeline.find((x) => x.kind === 'fixed'); assert.deepEqual([dent.start, dent.end], ['2026-11-26T13:00', '2026-11-26T15:00']);
    assert.equal(d.timeline.filter((x) => x.title === 'Dentist Appointment').length, 1, 'the fixed task is shown once, never as a flexible block');
    assert.equal(d.timeline[0].start, '2026-11-26T11:22', 'first session starts at the exact current minute');
    for (const x of d.timeline.filter((y) => y.kind === 'task')) assert.ok(x.end <= '2026-11-26T13:00' || x.start >= '2026-11-26T15:00');
  });
  test('Planner (GET draft) and Recommendations (generate response) are byte-identical in tasks, order and times', async () => {
    await mk('A', 30); await mk('B', 90, { isSplittable: true, minimumSessionMinutes: 30 });
    const gen = await sched.generateDraft(U, { mode: 'fresh', replace: true }); const planner = await sched.getOpen(U, 'draft'); const again = await sched.get(U, gen.schedule.id);
    assert.equal(sig(gen), sig(planner)); assert.equal(sig(gen), sig(again));
  });
  test('Get Recommendations replaces the previous draft: exactly one draft exists', async () => {
    await mk('A', 30); await sched.generateDraft(U, { mode: 'fresh', replace: true }); await sched.generateDraft(U, { mode: 'fresh', replace: true });
    assert.equal((await db.scheduleVersion.findMany({ where: { userId: U, status: 'draft' } })).length, 1);
  });
  test("the user's current energy/focus reach the ML session; availability comes from the calendar", async () => {
    await mk('A', 30); await sched.generateDraft(U, { mode: 'fresh', replace: true, energyLevel: 'Low', focusLevel: 'High' });
    assert.equal(sessions[0].energyLevel, 'Low'); assert.equal(sessions[0].focusLevel, 'High'); assert.ok(sessions[0].availableTimeMinutes >= 1);
    assert.throws(() => sv.generate({ energyLevel: 'Extreme' }));
  });
  test('split sessions are separate timeline entries that add up to the full duration', async () => {
    await appts.create(U, { title: 'Block', startAt: '2026-11-26 12:00', endAt: '2026-11-26 15:00', description: null, location: null, preparationBufferMinutes: 0, travelBufferMinutes: 0, importance: 'High', consequenceOfDelay: 'Major' });
    await mk('Study OS', 120, { isSplittable: true, minimumSessionMinutes: 30, dueDate: '2026-11-26' });
    const d = await sched.generateDraft(U, { mode: 'fresh', replace: true }); const s = d.timeline.filter((x) => x.title === 'Study OS');
    assert.ok(s.length >= 2); assert.equal(s.reduce((n, x) => n + x.durationMinutes, 0), 120); assert.deepEqual(s.map((x) => x.sessionIndex), s.map((_, i) => i + 1)); assert.ok(s.every((x) => x.sessionCount === s.length));
  });
  test('a prerequisite of a fixed-time demo is placed before it and listed as outstanding on the demo', async () => {
    const dev = await mk('Backend integration', 120);
    const demo = await mk('Project Demo', 30, { fixedTime: { startAt: '2026-11-26T16:30', durationMinutes: 30 } }); await deps.add(U, demo.id, dev.id);
    const d = await sched.generateDraft(U, { mode: 'fresh', replace: true });
    const devItem = d.timeline.find((x) => x.title === 'Backend integration'); const demoItem = d.timeline.find((x) => x.kind === 'fixed');
    assert.ok(devItem.end <= demoItem.start); assert.deepEqual(demoItem.prerequisites.map((p) => p.taskName), ['Backend integration']); assert.equal(d.infeasibilities.length, 0);
  });
  test('infeasible: the draft is still saved, the appointment is untouched and the explanation names the tasks and the numbers', async () => {
    await appts.createUnavailable(U, { label: 'Lunch', startAt: '2026-11-26 12:30', endAt: '2026-11-26 13:30' });
    const dev = await mk('Big prerequisite', 400, { isSplittable: true, minimumSessionMinutes: 30 });
    const demo = await mk('Project Demo', 30, { fixedTime: { startAt: '2026-11-26T16:30', durationMinutes: 30 } }); await deps.add(U, demo.id, dev.id);
    const d = await sched.generateDraft(U, { mode: 'fresh', replace: true }); const f = d.infeasibilities.find((x) => x.code === 'infeasible_before_fixed');
    assert.ok(f); assert.equal(f.requiredMinutes, 400); assert.ok(f.availableMinutes < 400); assert.ok(f.tasks.some((t) => t.taskName === 'Big prerequisite')); assert.match(f.message, /not feasible/);
    assert.deepEqual([d.timeline.find((x) => x.kind === 'fixed').start, d.timeline.find((x) => x.kind === 'fixed').end], ['2026-11-26T16:30', '2026-11-26T17:00']);
  });
});

describe('changes produce an updated DRAFT for review (never an auto-approval)', () => {
  test('nothing exists yet: no draft is created behind the user\'s back', async () => { await mk('A', 30); assert.equal(await sched.refreshDraftIfNeeded(U), null); assert.equal((await db.scheduleVersion.findMany({ where: { userId: U } })).length, 0); });
  test('a new task after an approved schedule creates a new draft; the approved schedule is untouched; the fixed appointment keeps its time', async () => {
    await mk('Dentist', 60, { fixedTime: { startAt: '2026-11-26T13:00', durationMinutes: 60 } }); await mk('A', 30);
    const d1 = await sched.generateDraft(U, { mode: 'fresh', replace: true }); await sched.approve(U, d1.schedule.id, { revision: d1.schedule.revision });
    assert.equal(await sched.refreshDraftIfNeeded(U), null, 'inputs unchanged: no new draft');
    await mk('New urgent task', 45); const d2 = await sched.refreshDraftIfNeeded(U);
    assert.equal(d2.schedule.status, 'draft'); assert.ok(d2.timeline.some((x) => x.title === 'New urgent task'));
    assert.equal((await sched.getOpen(U, 'approved')).schedule.id, d1.schedule.id);
    const f = d2.timeline.find((x) => x.kind === 'fixed'); assert.deepEqual([f.start, f.end], ['2026-11-26T13:00', '2026-11-26T14:00']);
  });
  test('a stale draft is replaced by an up-to-date one; completing a task removes it from the new draft', async () => {
    const a = await mk('A', 30); await mk('B', 30); const d1 = await sched.generateDraft(U, { mode: 'fresh', replace: true });
    await tasks.setStatus(U, a.id, { status: 'Completed' }); const d2 = await sched.refreshDraftIfNeeded(U);
    assert.notEqual(d2.schedule.id, d1.schedule.id); assert.equal(d2.timeline.some((x) => x.title === 'A'), false); assert.equal((await db.scheduleVersion.findMany({ where: { userId: U, status: 'draft' } })).length, 1);
  });
});
