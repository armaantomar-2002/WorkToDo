'use strict';
// Real PostgreSQL + Express + Prisma + argon2 + jose: the full HTTP API (ML service replaced by a deterministic stand-in).
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, resetDatabase, createClient, registerUser, fakeMlClient, TASK, SESSION } = require('./helpers');

let app;
before(async () => { app = await startServer({ mlClient: fakeMlClient() }); });
after(async () => { await resetDatabase(app.prisma); await app.close(); });
beforeEach(async () => { await resetDatabase(app.prisma); app.emails.length = 0; app.mlClient.calls.length = 0; });
const RUN_SESSION = { localTime: '2026-11-24 09:00:00', availableTimeMinutes: 120, longestFreeSlotMinutes: 90, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'Medium' };

describe('authentication', () => {
  test('register -> me -> logout; refresh cookie is HttpOnly + SameSite=Strict + path-scoped; no secrets in responses', async () => {
    const c = createClient(app.base);
    const r = await c.post('/auth/register', { fullName: 'Armaan', email: 'Armaan@Example.com', password: 'Password123' });
    assert.equal(r.status, 201); assert.equal(r.body.user.email, 'armaan@example.com'); assert.ok(r.body.accessToken); assert.ok(!JSON.stringify(r.body).match(/passwordHash|refreshToken/));
    const cookie = r.setCookie.find((x) => x.startsWith('wt_refresh=')); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\/api\/v1\/auth/);
    assert.equal((await c.get('/auth/me')).body.user.fullName, 'Armaan');
    assert.equal((await c.post('/auth/logout')).status, 200);
    assert.equal((await c.get('/auth/me')).status, 401);
    const stored = await app.prisma.authSession.findFirst(); assert.match(stored.refreshTokenHash, /^[0-9a-f]{64}$/); assert.ok(stored.revokedAt);
  });
  test('duplicate email, weak password, bad email -> 409 / 422', async () => {
    await registerUser(app.base, 'dup@example.com'); const c = createClient(app.base);
    assert.equal((await c.post('/auth/register', { fullName: 'X', email: 'dup@example.com', password: 'Password123' })).status, 409);
    assert.equal((await c.post('/auth/register', { fullName: 'X', email: 'new@example.com', password: 'short' })).status, 422);
    assert.equal((await c.post('/auth/register', { fullName: 'X', email: 'nope', password: 'Password123' })).status, 422);
  });
  test('login failure is generic; refresh rotates; replaying the old refresh token ends the session', async () => {
    await registerUser(app.base, 'rot@example.com'); const c = createClient(app.base);
    assert.equal((await c.post('/auth/login', { email: 'rot@example.com', password: 'Wrong12345' })).body.error, 'invalid_credentials');
    assert.equal((await c.post('/auth/login', { email: 'ghost@example.com', password: 'Wrong12345' })).body.error, 'invalid_credentials');
    await c.post('/auth/login', { email: 'rot@example.com', password: 'Password123' });
    const oldCookie = c.getCookie(); const r1 = await c.post('/auth/refresh'); assert.equal(r1.status, 200); assert.notEqual(c.getCookie(), oldCookie);
    await new Promise((r) => setTimeout(r, 10500)); // outside the 10 s benign-race window
    const thief = createClient(app.base); thief.setCookie(oldCookie);
    assert.equal((await thief.post('/auth/refresh')).status, 401);
    assert.equal((await c.post('/auth/refresh')).status, 401, 'the legitimate token family is revoked after reuse');
  });
  test('CSRF: state-changing requests need the custom header and an allowed Origin', async () => {
    const c = createClient(app.base);
    assert.equal((await c.post('/auth/login', { email: 'a@b.co', password: 'x' }, { csrf: false })).body.error, 'csrf_header_missing');
    const evil = createClient(app.base, 'http://evil.example'); assert.equal((await evil.post('/auth/login', { email: 'a@b.co', password: 'x' })).body.error, 'forbidden_origin');
  });
  test('CORS: allow-listed origin gets credentials; other origins do not', async () => {
    const ok = await fetch(`${app.base}/api/v1/auth/me`, { headers: { Origin: 'http://localhost:5173' } }); assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173'); assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    const bad = await fetch(`${app.base}/api/v1/auth/me`, { headers: { Origin: 'http://evil.example' } }); assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });
  test('change password signs out other sessions; forgot/reset works once and is non-enumerating', async () => {
    const { client } = await registerUser(app.base, 'pw@example.com'); const other = createClient(app.base); await other.post('/auth/login', { email: 'pw@example.com', password: 'Password123' });
    assert.equal((await client.post('/auth/change-password', { currentPassword: 'Wrong12345', newPassword: 'NewPassword456' })).status, 403);
    assert.equal((await client.post('/auth/change-password', { currentPassword: 'Password123', newPassword: 'NewPassword456' })).status, 200);
    assert.equal((await other.get('/auth/me')).status, 401); assert.equal((await client.get('/auth/me')).status, 200);
    const anon = createClient(app.base);
    assert.equal((await anon.post('/auth/forgot-password', { email: 'ghost@example.com' })).status, 202); assert.equal(app.emails.length, 0);
    assert.equal((await anon.post('/auth/forgot-password', { email: 'pw@example.com' })).status, 202); assert.equal(app.emails.length, 1);
    const token = /token=([\w-]+)/.exec(app.emails[0].text)[1];
    assert.equal((await anon.post('/auth/reset-password', { token, newPassword: 'ResetPass789' })).status, 200);
    assert.equal((await anon.post('/auth/reset-password', { token, newPassword: 'ResetPass789' })).status, 400);
    assert.equal((await client.get('/auth/me')).status, 401, 'reset revokes every session');
    assert.equal((await anon.post('/auth/login', { email: 'pw@example.com', password: 'ResetPass789' })).status, 200);
  });
  test('session management: list, revoke another session, cannot revoke someone else\'s', async () => {
    const { client } = await registerUser(app.base, 's1@example.com'); const second = createClient(app.base); await second.post('/auth/login', { email: 's1@example.com', password: 'Password123' });
    const list = (await client.get('/auth/sessions')).body.sessions; assert.equal(list.length, 2); assert.equal(list.filter((s) => s.current).length, 1);
    const target = list.find((s) => !s.current); assert.equal((await client.del(`/auth/sessions/${target.id}`)).status, 200); assert.equal((await second.get('/auth/me')).status, 401);
    const { client: stranger } = await registerUser(app.base, 's2@example.com'); assert.equal((await stranger.del(`/auth/sessions/${list.find((s) => s.current).id}`)).status, 404);
  });
  test('protected routes reject missing and tampered tokens', async () => {
    const c = createClient(app.base);
    for (const p of ['/tasks', '/sessions', '/dashboard/summary', '/insights/summary', '/recommendations/history', '/users/me', '/users/preferences']) assert.equal((await c.get(p)).status, 401, p);
    c.setToken('abc.def.ghi'); assert.equal((await c.get('/tasks')).status, 401);
  });
});

describe('tasks', () => {
  test('full CRUD persists; completing sets completedAt; delete is soft; validation errors use the standard envelope', async () => {
    const { client } = await registerUser(app.base);
    const created = await client.post('/tasks', TASK); assert.equal(created.status, 201); const id = created.body.task.id; assert.equal(created.body.task.status, 'Pending');
    assert.equal((await client.patch(`/tasks/${id}`, { taskName: 'Renamed', importance: 'Critical' })).body.task.importance, 'Critical');
    assert.ok((await client.patch(`/tasks/${id}/status`, { status: 'Completed' })).body.task.completedAt);
    const bad = await client.post('/tasks', { ...TASK, importance: 'Urgent', userId: 'x' }); assert.equal(bad.status, 422); assert.equal(bad.body.error, 'validation_error'); assert.ok(bad.body.errors.some((e) => e.field === 'importance')); assert.ok(bad.body.errors.some((e) => e.field === 'userId'));
    assert.equal((await client.del(`/tasks/${id}`)).status, 204); assert.equal((await client.get(`/tasks/${id}`)).status, 404);
    assert.ok((await app.prisma.task.findUnique({ where: { id } })).deletedAt, 'row is retained (soft delete)');
    assert.equal((await client.get('/tasks/not-a-uuid')).status, 404);
  });
  test('user isolation: another user can never see, edit, complete or delete my tasks', async () => {
    const { client: a } = await registerUser(app.base, 'a@example.com'); const { client: b } = await registerUser(app.base, 'b@example.com');
    const id = (await a.post('/tasks', TASK)).body.task.id;
    assert.equal((await b.get(`/tasks/${id}`)).status, 404); assert.equal((await b.patch(`/tasks/${id}`, { taskName: 'hijack' })).status, 404); assert.equal((await b.patch(`/tasks/${id}/status`, { status: 'Completed' })).status, 404); assert.equal((await b.del(`/tasks/${id}`)).status, 404);
    assert.equal((await b.get('/tasks')).body.total, 0); assert.equal((await a.get(`/tasks/${id}`)).body.task.taskName, TASK.taskName);
  });
  test('search, filter, sort and pagination', async () => {
    const { client } = await registerUser(app.base);
    for (let i = 1; i <= 12; i++) await client.post('/tasks', { ...TASK, taskName: `Task ${String(i).padStart(2, '0')}${i % 2 ? ' report' : ''}`, importance: ['Critical', 'High', 'Medium', 'Low'][i % 4], dueDate: `2026-12-${String(i).padStart(2, '0')}` });
    assert.equal((await client.get('/tasks?search=REPORT')).body.total, 6);
    const p2 = (await client.get('/tasks?pageSize=5&page=3&sortBy=taskName&sortOrder=asc')).body; assert.equal(p2.items.length, 2); assert.equal(p2.totalPages, 3);
    assert.equal((await client.get('/tasks?sortBy=importance&sortOrder=asc&pageSize=1')).body.items[0].importance, 'Critical');
    assert.equal((await client.get('/tasks?sortBy=dueDate&sortOrder=asc&pageSize=1')).body.items[0].dueDate, '2026-12-01');
    assert.equal((await client.get('/tasks?importance=Low,Medium')).body.total, 6); assert.equal((await client.get('/tasks?status=Completed')).body.total, 0);
    assert.equal((await client.get('/tasks?sortBy=passwordHash')).status, 422);
  });
});

describe('focus sessions', () => {
  test('CRUD, ownership, and no timezone shift on wall-clock times', async () => {
    const { client: a } = await registerUser(app.base, 'a@example.com'); const { client: b } = await registerUser(app.base, 'b@example.com');
    const s = (await a.post('/sessions', { ...SESSION, sessionDateTime: '2026-03-08 02:30:00' })).body.session; assert.equal(s.sessionDateTime, '2026-03-08 02:30:00');
    assert.equal((await a.patch(`/sessions/${s.id}`, { energyLevel: 'Low' })).body.session.energyLevel, 'Low'); assert.equal((await a.patch(`/sessions/${s.id}`, { longestFreeSlotMinutes: 999 })).status, 422);
    assert.equal((await b.get(`/sessions/${s.id}`)).status, 404); assert.equal((await b.del(`/sessions/${s.id}`)).status, 404);
    assert.equal((await a.del(`/sessions/${s.id}`)).status, 204); assert.equal((await a.get(`/sessions/${s.id}`)).status, 404);
  });
});

describe('recommendations: generate -> persist -> history', () => {
  test('uses ONLY the caller\'s tasks, saves run/items/exclusions, and history reproduces the result', async () => {
    const { client: a } = await registerUser(app.base, 'a@example.com'); const { client: b } = await registerUser(app.base, 'b@example.com');
    const t1 = (await a.post('/tasks', { ...TASK, taskName: 'First' })).body.task; await a.post('/tasks', { ...TASK, taskName: 'Second' }); const done = (await a.post('/tasks', { ...TASK, taskName: 'Finished' })).body.task; await a.patch(`/tasks/${done.id}/status`, { status: 'Completed' });
    await b.post('/tasks', { ...TASK, taskName: 'Not yours' });
    const run = await a.post('/recommendations/runs', RUN_SESSION); assert.equal(run.status, 201);
    const sent = app.mlClient.calls[0]; assert.deepEqual(sent.tasks.map((t) => t.task_name).sort(), ['Finished', 'First', 'Second']); assert.equal(sent.session.session_timestamp, '2026-11-24 09:00:00');
    assert.equal(run.body.ranked.length, 2); assert.equal(run.body.ranked[0].category, 'Do now'); assert.equal(run.body.excluded[0].taskName, 'Finished'); assert.equal(run.body.run.summary.eligible, 2);
    const hist = await a.get('/recommendations/history'); assert.equal(hist.body.total, 1); assert.equal(hist.body.items[0].topRecommendation.taskName, run.body.ranked[0].taskName);
    const detail = await a.get(`/recommendations/history/${run.body.run.id}`); assert.deepEqual(detail.body.ranked, run.body.ranked); assert.deepEqual(detail.body.excluded, run.body.excluded);
    assert.equal((await b.get(`/recommendations/history/${run.body.run.id}`)).status, 404); assert.equal((await b.get('/recommendations/history')).body.total, 0);
    await a.del(`/tasks/${t1.id}`); const after = (await a.get(`/recommendations/history/${run.body.run.id}`)).body; assert.equal(after.ranked.find((i) => i.taskName === 'First').taskName, 'First');
  });
  test('saved focus session is used; topK honoured; zero tasks -> 422 and nothing saved; ML failure saves nothing', async () => {
    const { client } = await registerUser(app.base);
    assert.equal((await client.post('/recommendations/runs', RUN_SESSION)).body.error, 'no_active_tasks'); assert.equal(await app.prisma.recommendationRun.count(), 0);
    await client.post('/tasks', TASK); await client.post('/tasks', { ...TASK, taskName: 'Two' });
    const s = (await client.post('/sessions', { ...SESSION, energyLevel: 'Low' })).body.session;
    const run = await client.post('/recommendations/runs', { focusSessionId: s.id, topK: 1 }); assert.equal(run.status, 201); assert.equal(run.body.ranked.length, 1); assert.equal(app.mlClient.calls.at(-1).session.energy_level, 'Low'); assert.equal(run.body.run.session.focusSessionId, s.id);
    assert.equal((await client.post('/recommendations/runs', { ...RUN_SESSION, tasks: [] })).status, 422);
    const original = app.mlClient.recommend; app.mlClient.recommend = async () => { const { AppError } = require('../src/errors/AppError'); throw new AppError({ status: 504, code: 'ml_timeout', message: 'The recommendation service timed out.' }); };
    const before = await app.prisma.recommendationRun.count(); assert.equal((await client.post('/recommendations/runs', RUN_SESSION)).status, 504); assert.equal(await app.prisma.recommendationRun.count(), before); app.mlClient.recommend = original;
  });
  test('the stateless endpoint stays available outside production', async () => {
    const res = await fetch(`${app.base}/api/v1/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: { localTime: '2026-11-24 09:00', availableTimeMinutes: 60, longestFreeSlotMinutes: 30, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High' }, tasks: [{ taskId: 't1', importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Major', complexity: 'Simple', estimatedDurationMinutes: 30, isSplittable: false, preferredTime: 'Anytime', status: 'Pending' }] }) });
    assert.equal(res.status, 200);
  });
});

describe('users, dashboard and insights', () => {
  test('profile + preferences persist; email change needs the current password', async () => {
    const { client } = await registerUser(app.base);
    assert.equal((await client.patch('/users/me', { fullName: 'New Name' })).body.user.fullName, 'New Name');
    assert.equal((await client.patch('/users/me', { email: 'changed@example.com' })).status, 403); assert.equal((await client.patch('/users/me', { email: 'changed@example.com', currentPassword: 'Password123' })).body.user.email, 'changed@example.com');
    assert.equal((await client.get('/users/preferences')).body.preferences.defaultEnergyLevel, 'Medium');
    const p = (await client.patch('/users/preferences', { defaultEnergyLevel: 'High', themePreference: 'dark', timeZone: 'Asia/Kolkata' })).body.preferences; assert.deepEqual([p.defaultEnergyLevel, p.themePreference, p.timeZone], ['High', 'dark', 'Asia/Kolkata']);
    assert.equal((await client.patch('/users/preferences', { timeZone: 'Mars/Base' })).status, 422); assert.equal((await client.patch('/users/preferences', { themePreference: 'neon' })).status, 422);
  });
  test('dashboard and insights are computed from real rows and are per-user; empty accounts give zeros', async () => {
    const { client: empty } = await registerUser(app.base, 'empty@example.com'); const e = (await empty.get('/dashboard/summary')).body;
    assert.deepEqual(e.stats, { totalTasks: 0, pendingTasks: 0, completedTasks: 0, completionPercentage: 0 }); assert.equal(e.todaysRecommendation, null); assert.equal(e.todaysFocus.source, 'preferences');
    const { client } = await registerUser(app.base, 'full@example.com');
    const a = (await client.post('/tasks', TASK)).body.task; const b = (await client.post('/tasks', { ...TASK, taskName: 'B' })).body.task; await client.patch(`/tasks/${b.id}/status`, { status: 'Completed' });
    await client.post('/sessions', { ...SESSION, sessionDateTime: `${new Date().toISOString().slice(0, 10)} 09:00:00` });
    await client.post('/recommendations/runs', RUN_SESSION);
    const d = (await client.get('/dashboard/summary')).body;
    assert.deepEqual(d.stats, { totalTasks: 2, pendingTasks: 1, completedTasks: 1, completionPercentage: 50 }); assert.equal(d.todaysRecommendation.item.taskId, a.id); assert.equal(d.todaysFocus.source, 'session'); assert.equal(d.recentTasks.length, 2); assert.ok(d.upcomingDeadlines.length >= 1);
    const sum = (await client.get('/insights/summary?range=7')).body; assert.equal(sum.totals.totalTasks, 2); assert.equal(sum.totals.completionRate, 50); assert.equal(sum.inRange.completed, 1);
    const tk = (await client.get('/insights/tasks?range=30')).body; assert.equal(tk.completionTrend.length, 30); assert.deepEqual(tk.byStatus.map((s) => s.count), [1, 0, 1, 0]); assert.equal(tk.byImportance.find((i) => i.name === 'High').count, 2);
    const ss = (await client.get('/insights/sessions?range=90')).body; assert.equal(ss.trend.length, 90); assert.equal(ss.totalSessions, 1);
    assert.equal((await client.get('/insights/summary?range=5')).status, 422);
    assert.equal((await empty.get('/insights/summary')).body.totals.totalTasks, 0);
  });
});

describe('error handling', () => {
  test('malformed JSON, unknown route and oversized body return safe envelopes', async () => {
    const { client } = await registerUser(app.base);
    const bad = await fetch(`${app.base}/api/v1/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'WorkToDo', Authorization: `Bearer ${'x'}` }, body: '{oops' }); assert.equal(bad.status, 400);
    assert.equal((await client.get('/nope')).status, 404);
    const big = await fetch(`${app.base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'WorkToDo' }, body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(2e6) }) }); assert.equal(big.status, 413);
  });
});
