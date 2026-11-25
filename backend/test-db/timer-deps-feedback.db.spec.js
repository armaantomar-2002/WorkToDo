'use strict';
// Real PostgreSQL + Express + Prisma + argon2 + jose (npm run test:db). NOT executed in the build sandbox (no Prisma/Express there).
// Covers: persistent focus timer, task dependencies, recommendation feedback, and a cross-user authorisation matrix.
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, resetDatabase, registerUser, fakeMlClient, TASK } = require('./helpers');

const clock = { t: Date.parse('2026-11-24T10:00:00.000Z') };
let app;
before(async () => { app = await startServer({ mlClient: fakeMlClient(), now: () => new Date(clock.t) }); });
after(async () => { await resetDatabase(app.prisma); await app.close(); });
beforeEach(async () => { await resetDatabase(app.prisma); clock.t = Date.parse('2026-11-24T10:00:00.000Z'); app.mlClient.calls.length = 0; });
const tick = (s) => { clock.t += s * 1000; };
const RUN = { localTime: '2026-11-24 09:00:00', availableTimeMinutes: 120, longestFreeSlotMinutes: 90, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'Medium' };
const mkTask = async (c, name, extra = {}) => (await c.post('/tasks', { ...TASK, taskName: name, ...extra })).body.task;

describe('focus timer (real DB)', () => {
  test('lifecycle persists in PostgreSQL: start, pause, resume, finish; elapsed comes from server timestamps and survives "refresh"', async () => {
    const { client: c } = await registerUser(app.base); const task = await mkTask(c, 'Deep work');
    const s = await c.post('/focus-timers', { taskId: task.id, plannedDurationMinutes: 25 }); assert.equal(s.status, 201); const id = s.body.timer.id;
    assert.equal((await c.get(`/tasks/${task.id}`)).body.task.status, 'In Progress');
    tick(300); assert.equal((await c.post(`/focus-timers/${id}/pause`)).body.timer.elapsedSeconds, 300);
    tick(600); const refreshed = (await c.get('/focus-timers/active')).body.timer; assert.equal(refreshed.status, 'paused'); assert.equal(refreshed.elapsedSeconds, 300); assert.equal(refreshed.pausedSeconds, 600);
    assert.equal((await c.post(`/focus-timers/${id}/resume`)).body.timer.status, 'running');
    tick(100); const f = await c.post(`/focus-timers/${id}/finish`, { completeTask: true }); assert.equal(f.body.timer.elapsedSeconds, 400); assert.equal(f.body.timer.pausedSeconds, 600);
    const row = await app.prisma.focusTimer.findUnique({ where: { id }, include: { pauses: true } }); assert.equal(row.actualFocusedSeconds, 400); assert.equal(row.pauses.length, 1); assert.ok(row.pauses[0].resumedAt);
    assert.equal((await c.get(`/tasks/${task.id}`)).body.task.status, 'Completed');
    assert.equal((await c.get('/focus-timers/active')).body.timer, null);
    assert.equal((await c.get('/focus-timers')).body.items[0].elapsedSeconds, 400);
  });
  test('duplicate/concurrent starts: exactly one wins (partial unique index); duplicate finish and bad transitions are 409', async () => {
    const { client: c } = await registerUser(app.base);
    const results = await Promise.all(Array.from({ length: 5 }, () => c.post('/focus-timers', { plannedDurationMinutes: 10 })));
    assert.equal(results.filter((r) => r.status === 201).length, 1); assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.error === 'timer_already_active'));
    assert.equal(await app.prisma.focusTimer.count({ where: { status: { in: ['running', 'paused'] } } }), 1);
    const id = results.find((r) => r.status === 201).body.timer.id;
    assert.equal((await c.post(`/focus-timers/${id}/resume`)).status, 409);
    const fin = await Promise.all([c.post(`/focus-timers/${id}/finish`), c.post(`/focus-timers/${id}/finish`)]);
    assert.deepEqual(fin.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await c.post(`/focus-timers/${id}/pause`)).status, 409);
  });
  test('isolation: another user cannot read or change my timer, and can run their own at the same time', async () => {
    const a = (await registerUser(app.base, 'a@example.com')).client; const b = (await registerUser(app.base, 'b@example.com')).client;
    const id = (await a.post('/focus-timers', {})).body.timer.id;
    for (const [m, p] of [['get', `/focus-timers/${id}`], ['post', `/focus-timers/${id}/pause`], ['post', `/focus-timers/${id}/finish`], ['post', `/focus-timers/${id}/cancel`]]) assert.equal((await b[m](p)).status, 404, p);
    assert.equal((await b.get('/focus-timers/active')).body.timer, null); assert.equal((await b.post('/focus-timers', {})).status, 201);
    const theirTask = await mkTask(a, 'private'); assert.equal((await b.post('/focus-timers', { taskId: theirTask.id })).status, 409); // b already has one -> still never leaks the task
    await b.post(`/focus-timers/${(await b.get('/focus-timers/active')).body.timer.id}/cancel`); assert.equal((await b.post('/focus-timers', { taskId: theirTask.id })).status, 404);
    assert.equal((await a.get(`/focus-timers/${id}`)).status, 200);
  });
  test('clients cannot supply timestamps or elapsed time; dashboard and insights use actual focused time', async () => {
    const { client: c } = await registerUser(app.base);
    assert.equal((await c.post('/focus-timers', { startedAt: '2020-01-01T00:00:00Z' })).status, 422);
    const id = (await c.post('/focus-timers', { plannedDurationMinutes: 30 })).body.timer.id; tick(1200); await c.post(`/focus-timers/${id}/finish`);
    const dash = (await c.get('/dashboard/summary')).body; assert.equal(dash.productivity.focusedMinutesToday, 20); assert.equal(dash.activeTimer, null);
    const ins = (await c.get('/insights/summary?range=7')).body; assert.equal(ins.totals.avgFocusMinutes, 20); assert.equal(ins.totals.totalFocusedMinutes, 20); assert.equal(ins.inRange.focusedMinutes, 20);
  });
});

describe('task dependencies (real DB)', () => {
  test('add/remove, Blocked <-> Ready as the prerequisite changes, listed on the task', async () => {
    const { client: c } = await registerUser(app.base); const pre = await mkTask(c, 'pre'); const t = await mkTask(c, 'main');
    const add = await c.post(`/tasks/${t.id}/dependencies`, { dependsOnTaskId: pre.id }); assert.equal(add.status, 201); assert.equal(add.body.dependencyStatus, 'Blocked');
    assert.equal((await c.get(`/tasks/${t.id}`)).body.task.dependencyStatus, 'Blocked'); assert.equal((await c.get('/tasks?dependencyStatus=Blocked')).body.total, 1);
    await c.patch(`/tasks/${pre.id}/status`, { status: 'Completed' }); assert.equal((await c.get(`/tasks/${t.id}`)).body.task.dependencyStatus, 'Ready');
    assert.equal((await c.get(`/tasks/${pre.id}/dependencies`)).body.dependents[0].taskName, 'main');
    await c.patch(`/tasks/${pre.id}/status`, { status: 'Pending' }); assert.equal((await c.get(`/tasks/${t.id}`)).body.task.dependencyStatus, 'Blocked');
    await c.del(`/tasks/${pre.id}`); assert.equal((await c.get(`/tasks/${t.id}`)).body.task.dependencyStatus, 'No dependency'); assert.equal(await app.prisma.taskDependency.count(), 0);
  });
  test('self, duplicate, direct and transitive cycles are rejected; concurrent opposite edges cannot both succeed', async () => {
    const { client: c } = await registerUser(app.base); const [a, b, d] = [await mkTask(c, 'a'), await mkTask(c, 'b'), await mkTask(c, 'c')];
    assert.equal((await c.post(`/tasks/${a.id}/dependencies`, { dependsOnTaskId: a.id })).body.error, 'self_dependency');
    await c.post(`/tasks/${b.id}/dependencies`, { dependsOnTaskId: a.id }); await c.post(`/tasks/${d.id}/dependencies`, { dependsOnTaskId: b.id });
    assert.equal((await c.post(`/tasks/${b.id}/dependencies`, { dependsOnTaskId: a.id })).status, 409);
    assert.equal((await c.post(`/tasks/${a.id}/dependencies`, { dependsOnTaskId: d.id })).body.error, 'circular_dependency');
    const x = await mkTask(c, 'x'); const y = await mkTask(c, 'y');
    const race = await Promise.all([c.post(`/tasks/${x.id}/dependencies`, { dependsOnTaskId: y.id }), c.post(`/tasks/${y.id}/dependencies`, { dependsOnTaskId: x.id })]);
    assert.equal(race.filter((r) => r.status === 201).length, 1, 'user-level lock prevents a cycle created by two concurrent requests');
  });
  test('isolation + database ownership constraint', async () => {
    const a = (await registerUser(app.base, 'a@example.com')).client; const b = (await registerUser(app.base, 'b@example.com')).client;
    const mine = await mkTask(a, 'mine'); const theirs = await mkTask(b, 'theirs');
    assert.equal((await a.post(`/tasks/${mine.id}/dependencies`, { dependsOnTaskId: theirs.id })).status, 422);
    assert.equal((await a.get(`/tasks/${theirs.id}/dependencies`)).status, 404); assert.equal((await a.post(`/tasks/${theirs.id}/dependencies`, { dependsOnTaskId: mine.id })).status, 404);
    const me = await app.prisma.user.findFirst({ where: { email: 'a@example.com' } });
    await assert.rejects(app.prisma.taskDependency.create({ data: { userId: me.id, taskId: mine.id, dependsOnTaskId: theirs.id } }), 'composite FK rejects a cross-user edge even if the API were bypassed');
    await assert.rejects(app.prisma.taskDependency.create({ data: { userId: me.id, taskId: mine.id, dependsOnTaskId: mine.id } }), 'CHECK rejects self edge');
  });
  test('recommendation runs receive derived statuses: a blocked task is excluded by the unchanged Python rules; exactly one ML call', async () => {
    const { client: c } = await registerUser(app.base); const pre = await mkTask(c, 'pre'); const t = await mkTask(c, 'main'); await c.post(`/tasks/${t.id}/dependencies`, { dependsOnTaskId: pre.id });
    const r = await c.post('/recommendations/runs', RUN); assert.equal(r.status, 201); assert.equal(app.mlClient.calls.length, 1);
    const sent = Object.fromEntries(app.mlClient.calls[0].tasks.map((x) => [x.task_name, x.dependency_status])); assert.deepEqual(sent, { pre: 'No dependency', main: 'Blocked' });
  });
});

describe('recommendation feedback (real DB)', () => {
  async function runFor(c) { await mkTask(c, 'one'); await mkTask(c, 'two'); const run = (await c.post('/recommendations/runs', RUN)).body; return { run, runId: run.run.id, item: run.ranked[0] }; }
  test('create, replace, persist in history, delete', async () => {
    const { client: c } = await registerUser(app.base); const { runId, item } = await runFor(c); const url = `/recommendations/runs/${runId}/items/${item.itemId}/feedback`;
    assert.equal((await c.put(url, { feedbackType: 'helpful', comment: 'nice' })).status, 200);
    assert.equal((await c.put(url, { feedbackType: 'not_relevant' })).body.feedback.feedbackType, 'not_relevant'); assert.equal(await app.prisma.recommendationFeedback.count(), 1);
    const detail = (await c.get(`/recommendations/history/${runId}`)).body; assert.equal(detail.ranked[0].feedback.feedbackType, 'not_relevant'); assert.equal(detail.ranked[1].feedback, null);
    assert.equal((await c.del(url)).status, 204); assert.equal((await c.get(`/recommendations/history/${runId}`)).body.ranked[0].feedback, null);
    assert.equal((await c.put(url, { feedbackType: 'bogus' })).status, 422);
  });
  test('isolation: no feedback on another user\'s run/item, mismatched run/item, or via direct DB writes', async () => {
    const a = (await registerUser(app.base, 'a@example.com')).client; const b = (await registerUser(app.base, 'b@example.com')).client;
    const ra = await runFor(a); const rb = await runFor(b); const urlA = `/recommendations/runs/${ra.runId}/items/${ra.item.itemId}/feedback`;
    assert.equal((await b.put(urlA, { feedbackType: 'helpful' })).status, 404); assert.equal((await b.del(urlA)).status, 404);
    assert.equal((await a.put(`/recommendations/runs/${ra.runId}/items/${rb.item.itemId}/feedback`, { feedbackType: 'helpful' })).status, 404);
    await a.put(urlA, { feedbackType: 'helpful' }); assert.equal((await b.get(`/recommendations/history/${ra.runId}`)).status, 404);
    const userB = await app.prisma.user.findFirst({ where: { email: 'b@example.com' } });
    await assert.rejects(app.prisma.recommendationFeedback.create({ data: { userId: userB.id, recommendationRunId: ra.runId, recommendationItemId: ra.item.itemId, feedbackType: 'helpful' } }), 'composite FK stops cross-user feedback at the database');
  });
  test('feedback survives task deletion (history snapshot) and is removed with the run', async () => {
    const { client: c } = await registerUser(app.base); const { runId, item } = await runFor(c); await c.put(`/recommendations/runs/${runId}/items/${item.itemId}/feedback`, { feedbackType: 'already_done' });
    await c.del(`/tasks/${item.taskId}`); assert.equal((await c.get(`/recommendations/history/${runId}`)).body.ranked[0].feedback.feedbackType, 'already_done');
    await app.prisma.recommendationRun.delete({ where: { id: runId } }); assert.equal(await app.prisma.recommendationFeedback.count(), 0);
  });
});

describe('authorisation matrix: user A can never reach user B\'s data', () => {
  test('tasks, sessions, history, timers, settings', async () => {
    const a = (await registerUser(app.base, 'a@example.com')).client; const b = (await registerUser(app.base, 'b@example.com')).client;
    const task = await mkTask(b, 'b-task'); const sess = (await b.post('/sessions', { sessionDateTime: '2026-11-24 09:00:00', availableTimeMinutes: 60, longestFreeSlotMinutes: 60, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High' })).body.session;
    const run = (await b.post('/recommendations/runs', RUN)).body.run; const timer = (await b.post('/focus-timers', {})).body.timer;
    const probes = [['get', `/tasks/${task.id}`], ['patch', `/tasks/${task.id}`, { taskName: 'pwn' }], ['patch', `/tasks/${task.id}/status`, { status: 'Completed' }], ['del', `/tasks/${task.id}`],
      ['get', `/sessions/${sess.id}`], ['patch', `/sessions/${sess.id}`, { availableTimeMinutes: 5 }], ['del', `/sessions/${sess.id}`],
      ['get', `/recommendations/history/${run.id}`], ['get', `/focus-timers/${timer.id}`], ['post', `/focus-timers/${timer.id}/finish`]];
    for (const [m, p, body] of probes) assert.equal((await a[m](p, body)).status, 404, `${m} ${p}`);
    assert.equal((await a.get('/tasks')).body.total, 0); assert.equal((await a.get('/sessions')).body.total, 0); assert.equal((await a.get('/recommendations/history')).body.total, 0);
    assert.equal((await a.post('/recommendations/runs', { ...RUN, focusSessionId: sess.id })).status, 404);
    assert.equal((await b.get(`/tasks/${task.id}`)).body.task.taskName, 'b-task', 'B\'s data is untouched');
    assert.equal((await a.patch('/users/preferences', { themePreference: 'dark' })).status, 200); assert.equal((await b.get('/users/preferences')).body.preferences.themePreference, 'light', 'settings are per user');
  });
});
