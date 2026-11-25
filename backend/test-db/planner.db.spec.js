'use strict';
// Real PostgreSQL + Express + Prisma: planner HTTP flow, ownership, constraints and concurrency.
// NOT executed in the authoring sandbox (no npm packages / Prisma engine there). Run with `npm run test:db`.
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, resetDatabase, createClient, registerUser, fakeMlClient } = require('./helpers');

const NOW = new Date('2026-11-25T02:30:00Z'); // 08:00 on 25 Nov 2026 in Asia/Kolkata
let app;
before(async () => { app = await startServer({ mlClient: fakeMlClient(), now: () => NOW }); });
after(async () => { await resetDatabase(app.prisma); await app.close(); });
beforeEach(async () => { await resetDatabase(app.prisma); });

const TASK = (n, m, extra = {}) => ({ taskName: n, importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Significant', estimatedDurationMinutes: m, preferredTime: 'Anytime', isSplittable: false, ...extra });
const APPT = (o = {}) => ({ title: 'Dentist', startAt: '2026-11-25T11:00', endAt: '2026-11-25T12:00', ...o });
async function user(email = 'a@example.com') { const { client } = await registerUser(app.base, email); await client.patch('/users/preferences', { workDays: [0, 1, 2, 3, 4, 5, 6], planningHorizonDays: 3 }); return client; }

describe('planner over real PostgreSQL', () => {
  test('appointments: create, overlap -> 409, reschedule history, cancel; default time zone is Asia/Kolkata', async () => {
    const c = await user(); assert.equal((await c.get('/users/preferences')).body.preferences.timeZone, 'Asia/Kolkata');
    const a = await c.post('/appointments', APPT()); assert.equal(a.status, 201);
    assert.equal((await c.post('/appointments', APPT({ title: 'Clash', startAt: '2026-11-25T11:30', endAt: '2026-11-25T12:30' }))).body.error, 'appointment_conflict');
    const id = a.body.appointment.id; const r = await c.patch(`/appointments/${id}`, { startAt: '2026-11-25T15:00', endAt: '2026-11-25T16:00', revision: 1 }); assert.equal(r.status, 200);
    assert.equal((await c.patch(`/appointments/${id}`, { title: 'x', revision: 1 })).body.error, 'stale_revision');
    assert.deepEqual((await c.get(`/appointments/${id}/history`)).body.history.map((h) => h.action), ['created', 'rescheduled']);
    assert.equal((await c.post(`/appointments/${id}/cancel`, {})).status, 200); assert.equal((await c.post(`/appointments/${id}/cancel`, {})).body.error, 'invalid_transition');
  });
  test('simultaneous overlapping appointment creates: exactly one succeeds (user-row lock)', async () => {
    const c = await user(); const rs = await Promise.all([1, 2, 3, 4].map((i) => c.post('/appointments', APPT({ title: `T${i}` })))); assert.equal(rs.filter((r) => r.status === 201).length, 1); assert.ok(rs.every((r) => [201, 409].includes(r.status)));
  });
  test('draft -> approve; second approve is refused; the DB holds at most one draft and one approved; approved rows survive rejection of a later draft', async () => {
    const c = await user(); await c.post('/appointments', APPT()); await c.post('/tasks', TASK('Alpha', 60)); await c.post('/tasks', TASK('Beta', 90));
    const d = await c.post('/schedules/drafts', {}); assert.equal(d.status, 201); assert.equal((await c.get('/schedules/active')).body.schedule, null);
    for (const b of d.body.blocks) assert.ok(b.end <= '2026-11-25T11:00' || b.start >= '2026-11-25T12:00');
    const id = d.body.schedule.id; const ap = await Promise.all([c.post(`/schedules/${id}/approve`, {}), c.post(`/schedules/${id}/approve`, {})]); assert.equal(ap.filter((r) => r.status === 200).length, 1);
    assert.equal(await app.prisma.scheduleVersion.count({ where: { status: 'approved' } }), 1);
    const before = await app.prisma.scheduledBlock.count({ where: { scheduleVersionId: id } });
    const d2 = await c.post('/schedules/drafts', { mode: 'fresh' }); await c.post(`/schedules/${d2.body.schedule.id}/reject`, {}); assert.equal(await app.prisma.scheduledBlock.count({ where: { scheduleVersionId: id } }), before);
    assert.equal((await c.get('/schedules/active')).body.schedule.schedule.id, id);
  });
  test('stale draft cannot be approved; invalid moves are rejected and nothing is stored; ML outage falls back', async () => {
    const c = await user(); await c.post('/tasks', TASK('Alpha', 60)); const d = await c.post('/schedules/drafts', {}); const blk = d.body.blocks[0];
    assert.equal((await c.patch(`/schedules/${d.body.schedule.id}/blocks/${blk.id}`, { start: '2026-11-25T22:00' })).body.error, 'schedule_conflict');
    assert.equal((await c.get(`/schedules/${d.body.schedule.id}`)).body.blocks[0].start, blk.start);
    await c.post('/appointments', APPT({ startAt: '2026-11-26T10:00', endAt: '2026-11-26T11:00' }));
    assert.equal((await c.post(`/schedules/${d.body.schedule.id}/approve`, {})).body.error, 'draft_stale');
    app.mlClient.recommend = async () => { throw new Error('down'); }; const f = await c.post('/schedules/drafts', { replace: true }); assert.equal(f.status, 201); assert.equal(f.body.schedule.orderSource, 'fallback');
  });
  test('ownership: another user gets 404 for every appointment/schedule/postponement id; calendar shows only own data', async () => {
    const a = await user('a@example.com'); const b = await user('b@example.com');
    const ap = (await a.post('/appointments', APPT())).body.appointment; const t = (await a.post('/tasks', TASK('Mine', 30))).body.task; const d = (await a.post('/schedules/drafts', {})).body;
    for (const [m, p, body] of [['get', `/appointments/${ap.id}`], ['patch', `/appointments/${ap.id}`, { title: 'x' }], ['post', `/appointments/${ap.id}/cancel`, {}], ['get', `/appointments/${ap.id}/history`], ['get', `/schedules/${d.schedule.id}`], ['post', `/schedules/${d.schedule.id}/approve`, {}], ['post', `/schedules/${d.schedule.id}/reject`, {}], ['get', `/schedules/${d.schedule.id}/diff`], ['post', `/tasks/${t.id}/postpone`, {}], ['get', `/tasks/${t.id}/postponements`]]) {
      const r = await b[m](p, body); assert.equal(r.status, 404, `${m} ${p}`);
    }
    const cal = await b.get('/calendar?from=2026-11-25&to=2026-11-27'); assert.equal(cal.body.appointments.length, 0); assert.equal(cal.body.draftBlocks.length, 0);
    assert.equal((await createClient(app.base).get('/appointments')).status, 401); assert.equal((await createClient(app.base).get('/calendar?from=2026-11-25&to=2026-11-25')).status, 401);
  });
  test('postpone keeps the due date, requires confirmation past it, and records history', async () => {
    const c = await user(); const t = (await c.post('/tasks', TASK('Report', 60, { dueDate: '2026-11-26' }))).body.task;
    assert.equal((await c.post(`/tasks/${t.id}/postpone`, { days: 1 })).status, 201);
    assert.equal((await c.post(`/tasks/${t.id}/postpone`, { days: 1 })).body.error, 'confirmation_required');
    assert.equal((await c.post(`/tasks/${t.id}/postpone`, { days: 1, confirm: true })).status, 201);
    const h = (await c.get(`/tasks/${t.id}/postponements`)).body; assert.equal(h.postponeCount, 2); assert.equal((await c.get(`/tasks/${t.id}`)).body.task.dueDate, '2026-11-26');
  });
  test('database CHECK/unique constraints back the API rules', async () => {
    const c = await user(); const u = await app.prisma.user.findFirst();
    await assert.rejects(app.prisma.appointment.create({ data: { userId: u.id, title: 'bad', startAt: new Date('2026-11-25T12:00:00Z'), endAt: new Date('2026-11-25T11:00:00Z') } }));
    await c.post('/tasks', TASK('x', 30)); await c.post('/schedules/drafts', {});
    await assert.rejects(app.prisma.scheduleVersion.create({ data: { userId: u.id, versionNumber: 99, status: 'draft', mode: 'fresh', orderSource: 'fallback', horizonFrom: new Date('2026-11-25T00:00:00Z'), horizonTo: new Date('2026-11-27T00:00:00Z'), generatedAtLocal: new Date('2026-11-25T08:00:00Z'), inputHash: 'x' } }), 'second open draft must violate the partial unique index');
  });
});
