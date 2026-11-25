'use strict';
// Hermetic service-logic tests using an in-memory Prisma STAND-IN and stubbed argon2/jose (see test-support/).
// They prove the application logic (rotation, reuse detection, ownership filters, persistence payloads); they do NOT prove
// Prisma/PostgreSQL behaviour (see test-db/).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { installStubs } = require('../test-support/stubDeps');
const { createMemoryPrisma } = require('../test-support/memoryPrisma');

let restore;
before(() => { restore = installStubs(); });
after(() => restore());

const { loadConfig } = require('../src/config/env');
const { AppError } = require('../src/errors/AppError');
const CONFIG = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@h/db', JWT_ACCESS_SECRET: 's'.repeat(40) });
const code = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof AppError, String(e && e.stack)); return `${e.status}:${e.code}`; } return 'no-error'; };

function authFixture() {
  const { createAuthService } = require('../src/modules/auth/auth.service');
  const prisma = createMemoryPrisma(); const sent = []; const clock = { t: Date.parse('2026-11-24T10:00:00Z') };
  const service = createAuthService({ prisma, config: CONFIG, emailProvider: { send: async (m) => { sent.push(m); return { delivered: false }; } }, now: () => new Date(clock.t) });
  return { prisma, service, sent, clock };
}
const REG = { fullName: 'Armaan', email: 'a@example.com', password: 'Password123' };

describe('auth service', () => {
  test('register: stores only a password hash, creates preferences and a session; returns no secrets', async () => {
    const { prisma, service } = authFixture();
    const r = await service.register(REG, { userAgent: 'UA' });
    assert.equal(r.user.email, 'a@example.com'); assert.ok(r.accessToken); assert.ok(r.refreshToken);
    assert.deepEqual(Object.keys(r.user).sort(), ['createdAt', 'email', 'fullName', 'id', 'isEmailVerified']);
    const row = prisma._tables.user[0]; assert.notEqual(row.passwordHash, REG.password); assert.equal(prisma._tables.userPreferences.length, 1);
    const s = prisma._tables.authSession[0]; assert.notEqual(s.refreshTokenHash, r.refreshToken); assert.match(s.refreshTokenHash, /^[0-9a-f]{64}$/);
    assert.equal(await code(service.register(REG)), '409:email_taken');
  });
  test('login: wrong password and unknown email are indistinguishable; inactive users cannot log in', async () => {
    const { prisma, service } = authFixture(); await service.register(REG);
    assert.equal(await code(service.login({ email: 'a@example.com', password: 'Wrong12345' })), '401:invalid_credentials');
    assert.equal(await code(service.login({ email: 'nobody@example.com', password: 'Password123' })), '401:invalid_credentials');
    assert.ok((await service.login({ email: 'a@example.com', password: 'Password123', rememberMe: true })).refreshMaxAgeSeconds > 7 * 86400);
    prisma._tables.user[0].isActive = false;
    assert.equal(await code(service.login({ email: 'a@example.com', password: 'Password123' })), '401:invalid_credentials');
  });
  test('refresh rotates the token: old one is revoked and linked, new one works', async () => {
    const { prisma, service, clock } = authFixture(); const first = await service.register(REG);
    clock.t += 60000; const second = await service.refresh(first.refreshToken);
    assert.notEqual(second.refreshToken, first.refreshToken);
    const [oldRow, newRow] = prisma._tables.authSession; assert.ok(oldRow.revokedAt); assert.equal(oldRow.replacedById, newRow.id); assert.equal(oldRow.familyId, newRow.familyId); assert.equal(newRow.revokedAt, null);
    clock.t += 60000; assert.ok(await service.refresh(second.refreshToken));
  });
  test('reuse of a rotated token (outside the grace window) revokes the whole family', async () => {
    const { prisma, service, clock } = authFixture(); const first = await service.register(REG);
    clock.t += 60000; const second = await service.refresh(first.refreshToken);
    clock.t += 60000; assert.equal(await code(service.refresh(first.refreshToken)), '401:invalid_refresh_token');
    assert.ok(prisma._tables.authSession.every((s) => s.revokedAt), 'every session in the family is revoked');
    assert.equal(await code(service.refresh(second.refreshToken)), '401:invalid_refresh_token');
  });
  test('a just-rotated token presented again (two tabs) is a benign race: no family revocation', async () => {
    const { prisma, service, clock } = authFixture(); const first = await service.register(REG);
    clock.t += 1000; const second = await service.refresh(first.refreshToken);
    clock.t += 1000; assert.equal(await code(service.refresh(first.refreshToken)), '401:refresh_race');
    assert.equal(prisma._tables.authSession.filter((s) => !s.revokedAt).length, 1); assert.ok(await service.refresh(second.refreshToken));
  });
  test('refresh: expired, unknown and malformed tokens are rejected', async () => {
    const { service, clock } = authFixture(); const r = await service.register(REG);
    assert.equal(await code(service.refresh('x'.repeat(43))), '401:invalid_refresh_token'); assert.equal(await code(service.refresh(undefined)), '401:invalid_refresh_token'); assert.equal(await code(service.refresh('short')), '401:invalid_refresh_token');
    clock.t += 8 * 86400000; assert.equal(await code(service.refresh(r.refreshToken)), '401:invalid_refresh_token');
  });
  test('logout revokes the family (by cookie token and/or access-token family) and is idempotent', async () => {
    const { prisma, service } = authFixture(); const r = await service.register(REG);
    await service.logout({ refreshToken: r.refreshToken }); await service.logout({ refreshToken: r.refreshToken }); await service.logout({});
    assert.ok(prisma._tables.authSession.every((s) => s.revokedAt)); assert.equal(await code(service.refresh(r.refreshToken)), '401:invalid_refresh_token');
  });
  test('requireAuth accepts a live session and rejects revoked / missing / forged tokens', async () => {
    const { requireAuth } = require('../src/auth/requireAuth'); const { prisma, service } = authFixture();
    const r = await service.register(REG); const mw = requireAuth({ prisma, config: CONFIG });
    const call = (authorization) => new Promise((resolve) => { const req = { headers: { authorization } }; mw(req, {}, (err) => resolve({ err, req })); });
    const ok = await call(`Bearer ${r.accessToken}`); assert.equal(ok.err, undefined); assert.equal(ok.req.auth.userId, r.user.id);
    assert.equal((await call(undefined)).err.status, 401); assert.equal((await call('Bearer not.a.jwt!')).err.status, 401); assert.equal((await call('Basic abc')).err.status, 401);
    await service.logout({ refreshToken: r.refreshToken });
    assert.equal((await call(`Bearer ${r.accessToken}`)).err.code, 'unauthorized');
  });
  test('change password: verifies current, rejects same password, signs out other devices only', async () => {
    const { prisma, service } = authFixture(); const a = await service.register(REG); const b = await service.login({ email: REG.email, password: REG.password });
    const famA = prisma._tables.authSession[0].familyId;
    assert.equal(await code(service.changePassword(a.user.id, famA, { currentPassword: 'Nope123456', newPassword: 'NewPassword456' })), '403:invalid_current_password');
    assert.equal(await code(service.changePassword(a.user.id, famA, { currentPassword: REG.password, newPassword: REG.password })), '422:validation_error');
    await service.changePassword(a.user.id, famA, { currentPassword: REG.password, newPassword: 'NewPassword456' });
    assert.equal(prisma._tables.authSession.filter((s) => !s.revokedAt).map((s) => s.familyId).join(), famA);
    assert.equal(await code(service.refresh(b.refreshToken)), '401:invalid_refresh_token'); assert.ok(await service.login({ email: REG.email, password: 'NewPassword456' }));
    assert.equal(await code(service.login({ email: REG.email, password: REG.password })), '401:invalid_credentials');
  });
  test('forgot/reset password: no enumeration, single-use, expiring, revokes sessions', async () => {
    const { prisma, service, sent, clock } = authFixture(); const reg = await service.register(REG);
    await service.forgotPassword({ email: 'nobody@example.com' }); assert.equal(sent.length, 0); assert.equal(prisma._tables.passwordResetToken?.length ?? 0, 0);
    await service.forgotPassword({ email: REG.email }); assert.equal(sent.length, 1);
    const token = /token=([\w-]+)/.exec(sent[0].text)[1]; assert.ok(!JSON.stringify(prisma._tables.passwordResetToken).includes(token), 'raw token is never stored');
    await service.forgotPassword({ email: REG.email }); assert.equal(prisma._tables.passwordResetToken.filter((t) => !t.usedAt).length, 1, 'older links are invalidated');
    assert.equal(await code(service.resetPassword({ token, newPassword: 'ResetPass789' })), '400:invalid_reset_token');
    const fresh = /token=([\w-]+)/.exec(sent[1].text)[1];
    await service.resetPassword({ token: fresh, newPassword: 'ResetPass789' });
    assert.equal(await code(service.resetPassword({ token: fresh, newPassword: 'AnotherPass1' })), '400:invalid_reset_token');
    assert.equal(await code(service.refresh(reg.refreshToken)), '401:invalid_refresh_token'); assert.ok(await service.login({ email: REG.email, password: 'ResetPass789' }));
    await service.forgotPassword({ email: REG.email }); const t3 = /token=([\w-]+)/.exec(sent[2].text)[1]; clock.t += 31 * 60000;
    assert.equal(await code(service.resetPassword({ token: t3, newPassword: 'Expired12345' })), '400:invalid_reset_token');
  });
  test('sessions: list marks the current one; revoking another user\'s session is a 404', async () => {
    const { service } = authFixture(); const me = await service.register(REG); const other = await service.register({ ...REG, email: 'b@example.com' });
    const mine = await service.login({ email: REG.email, password: REG.password });
    const list = await service.listSessions(me.user.id, null); assert.equal(list.length, 2); assert.ok(list.every((s) => !('refreshTokenHash' in s)));
    assert.equal(await code(service.revokeSession(other.user.id, list[0].id)), '404:not_found'); void mine;
  });
});

const OTHER = '99999999-9999-4999-8999-999999999999';
const TASK = { taskName: 'T', importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Major', complexity: 'Simple', estimatedDurationMinutes: 30, description: null, startDate: null, dueDate: '2026-12-01', minimumSessionMinutes: null, isSplittable: false, preferredTime: 'Anytime', dependencyStatus: 'No dependency', status: 'Pending' };

describe('tasks service (ownership, soft delete, status)', () => {
  const fixture = () => { const { createTasksService } = require('../src/modules/tasks/tasks.service'); const prisma = createMemoryPrisma(); return { prisma, svc: createTasksService({ prisma }) }; };
  const Q = { sortBy: 'createdAt', sortOrder: 'desc', page: 1, pageSize: 10 };
  test('create takes the owner from the session (never the body) and derives importanceRank', async () => {
    const { prisma, svc } = fixture(); const t = await svc.create('u1', TASK);
    assert.equal(prisma._tables.task[0].userId, 'u1'); assert.equal(prisma._tables.task[0].importanceRank, 2); assert.equal(t.dueDate, '2026-12-01'); assert.ok(!('userId' in t));
  });
  test('users cannot read, change, complete or delete each other\'s tasks (404, not 403)', async () => {
    const { svc } = fixture(); const mine = await svc.create('u1', TASK);
    assert.equal(await code(svc.get(OTHER, mine.id)), '404:not_found'); assert.equal(await code(svc.update(OTHER, mine.id, { taskName: 'x' })), '404:not_found');
    assert.equal(await code(svc.setStatus(OTHER, mine.id, { status: 'Completed' })), '404:not_found'); assert.equal(await code(svc.remove(OTHER, mine.id)), '404:not_found');
    assert.equal((await svc.list(OTHER, Q)).total, 0); assert.equal((await svc.get('u1', mine.id)).taskName, 'T');
  });
  test('status changes maintain completedAt', async () => {
    const { svc } = fixture(); const t = await svc.create('u1', TASK);
    const done = await svc.setStatus('u1', t.id, { status: 'Completed' }); assert.ok(done.completedAt);
    assert.equal((await svc.setStatus('u1', t.id, { status: 'Pending' })).completedAt, null);
    assert.ok((await svc.update('u1', t.id, { status: 'Completed' })).completedAt);
  });
  test('delete is soft: gone from every read but the row remains', async () => {
    const { prisma, svc } = fixture(); const t = await svc.create('u1', TASK); await svc.remove('u1', t.id);
    assert.equal(await code(svc.get('u1', t.id)), '404:not_found'); assert.equal((await svc.list('u1', Q)).total, 0); assert.equal(await code(svc.remove('u1', t.id)), '404:not_found');
    assert.ok(prisma._tables.task[0].deletedAt);
  });
  test('update re-validates cross-field rules against the stored task', async () => {
    const { svc } = fixture(); const t = await svc.create('u1', { ...TASK, isSplittable: true, minimumSessionMinutes: 20 });
    assert.equal(await code(svc.update('u1', t.id, { estimatedDurationMinutes: 10 })), '422:validation_error');
    assert.equal((await svc.update('u1', t.id, { isSplittable: false })).minimumSessionMinutes, null);
  });
  test('list: search, status filter, importance sort and pagination', async () => {
    const { svc } = fixture();
    for (const [n, imp] of [['Alpha report', 'Low'], ['Beta call', 'Critical'], ['Gamma report', 'Medium']]) await svc.create('u1', { ...TASK, taskName: n, importance: imp });
    await svc.create('u2', { ...TASK, taskName: 'Alpha report' });
    assert.equal((await svc.list('u1', { ...Q, search: 'REPORT' })).total, 2);
    assert.equal((await svc.list('u1', { ...Q, sortBy: 'importance', sortOrder: 'asc' })).items[0].taskName, 'Beta call');
    const p = await svc.list('u1', { ...Q, pageSize: 2, page: 2 }); assert.equal(p.items.length, 1); assert.equal(p.totalPages, 2); assert.equal(p.total, 3);
    assert.equal((await svc.list('u1', { ...Q, status: ['Completed'] })).total, 0);
  });
});

describe('recommendation runs service', () => {
  const SESSION = { localTime: '2026-11-24 09:00:00', availableTimeMinutes: 120, longestFreeSlotMinutes: 90, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High' };
  function fixture(mlBehaviour) {
    const { createRunsService } = require('../src/modules/recommendations/runs.service'); const { createTasksService } = require('../src/modules/tasks/tasks.service');
    const prisma = createMemoryPrisma(); const calls = [];
    const recommendationService = { async recommend(req) { calls.push(req); return mlBehaviour(req); } };
    return { prisma, calls, tasks: createTasksService({ prisma }), runs: createRunsService({ prisma, recommendationService }) };
  }
  const rankAll = (req) => {
    const active = req.tasks.filter((t) => t.status === 'Pending' || t.status === 'In Progress'); const inactive = req.tasks.filter((t) => !active.includes(t));
    const f = { urgency: 50, importance: 50, goalContribution: 50, feasibility: 50, consequenceOfDelay: 50, timingSuitability: 50, energySuitability: 50 };
    return { ranked: active.map((t, i) => ({ rank: i + 1, taskId: t.taskId, taskName: t.taskName, mlScore: 90 - i, category: i === 0 ? 'Do now' : 'Do next', startableNow: true, reason: 'because', ...f })), excluded: inactive.map((t) => ({ taskId: t.taskId, exclusionReason: 'Task not active' })), summary: { totalTasks: req.tasks.length, eligible: active.length, excluded: inactive.length, returned: active.length, startableNow: active.length } };
  };
  test('loads ONLY the caller\'s tasks, server-side; the client cannot supply a task list', async () => {
    const { tasks, runs, calls } = fixture(rankAll);
    const mine = await tasks.create('u1', { ...TASK, taskName: 'Mine' }); await tasks.create('u2', { ...TASK, taskName: 'Theirs' });
    const done = await tasks.create('u1', { ...TASK, taskName: 'Done' }); await tasks.setStatus('u1', done.id, { status: 'Completed' });
    const gone = await tasks.create('u1', { ...TASK, taskName: 'Deleted' }); await tasks.remove('u1', gone.id);
    const out = await runs.create('u1', { ...SESSION });
    assert.deepEqual(calls[0].tasks.map((t) => t.taskName).sort(), ['Done', 'Mine']); assert.deepEqual(calls[0].session.localTime, SESSION.localTime);
    assert.equal(out.ranked[0].taskId, mine.id); assert.equal(out.excluded[0].taskName, 'Done'); assert.equal(out.excluded[0].exclusionReason, 'Task not active');
  });
  test('persists run + items + exclusions with snapshots exactly as returned by Python', async () => {
    const { prisma, tasks, runs } = fixture(rankAll); await tasks.create('u1', TASK);
    const out = await runs.create('u1', { ...SESSION, topK: 3 });
    const run = prisma._tables.recommendationRun[0]; assert.equal(run.userId, 'u1'); assert.equal(run.topK, 3); assert.equal(run.eligibleTasks, 1); assert.equal(run.sessionDateTime.toISOString(), '2026-11-24T09:00:00.000Z');
    const item = prisma._tables.recommendationItem[0]; assert.equal(item.taskNameSnapshot, 'T'); assert.equal(item.taskSnapshot.dueDate, '2026-12-01'); assert.equal(item.mlScore, 90); assert.equal(item.category, 'Do now');
    assert.equal(out.run.id, run.id); assert.equal(out.ranked[0].dueDate, '2026-12-01'); assert.equal(out.run.session.localTime, '2026-11-24 09:00:00'); assert.equal(out.ranked[0].mlScore, 90);
  });
  test('nothing is saved when the ML pipeline fails (timeout / unavailable / invalid)', async () => {
    for (const [status, c] of [[504, 'ml_timeout'], [503, 'ml_service_unavailable'], [502, 'ml_invalid_response']]) {
      const { prisma, tasks, runs } = fixture(() => { throw new AppError({ status, code: c, message: 'x' }); }); await tasks.create('u1', TASK);
      assert.equal(await code(runs.create('u1', SESSION)), `${status}:${c}`); assert.equal(prisma._tables.recommendationRun?.length ?? 0, 0);
    }
  });
  test('Python returning an unknown or duplicated task id is rejected and nothing is saved', async () => {
    const { prisma, tasks, runs } = fixture((req) => { const r = rankAll(req); r.ranked[0].taskId = 'not-sent'; return r; }); await tasks.create('u1', TASK);
    assert.equal(await code(runs.create('u1', SESSION)), '502:ml_invalid_response'); assert.equal(prisma._tables.recommendationRun?.length ?? 0, 0);
  });
  test('zero active tasks -> 422 and Python is never called', async () => {
    const { tasks, runs, calls } = fixture(rankAll); const t = await tasks.create('u1', TASK); await tasks.setStatus('u1', t.id, { status: 'Completed' });
    assert.equal(await code(runs.create('u1', SESSION)), '422:no_active_tasks'); assert.equal(calls.length, 0);
  });
  test('more than 500 active tasks -> 422; inactive context is capped', async () => {
    const { prisma, runs, calls } = fixture(rankAll); const mk = (i, status) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, userId: 'u1', taskName: `t${i}`, importance: 'Low', importanceRank: 4, goalContribution: 'Low', consequenceOfDelay: 'Minor', complexity: 'Simple', estimatedDurationMinutes: 5, isSplittable: false, preferredTime: 'Anytime', dependencyStatus: 'No dependency', status, startDate: null, dueDate: null, createdAt: new Date(i), updatedAt: new Date(i) });
    for (let i = 0; i < 40; i++) await prisma.task.create({ data: mk(i, 'Completed') });
    for (let i = 100; i < 105; i++) await prisma.task.create({ data: mk(i, 'Pending') });
    await runs.create('u1', SESSION); assert.equal(calls[0].tasks.length, 5 + 25);
    for (let i = 200; i < 700; i++) await prisma.task.create({ data: mk(i, 'Pending') });
    assert.equal(await code(runs.create('u1', SESSION)), '422:too_many_tasks');
  });
  test('saved focus session: uses its stored values; another user\'s session is a 404', async () => {
    const { prisma, tasks, runs, calls } = fixture(rankAll); await tasks.create('u1', TASK);
    const s = await prisma.focusSession.create({ data: { userId: 'u1', sessionDateTime: new Date('2026-11-25T14:00:00Z'), availableTimeMinutes: 45, longestFreeSlotMinutes: 30, currentTimePeriod: 'Afternoon', energyLevel: 'Low', focusLevel: 'Medium' } });
    const out = await runs.create('u1', { focusSessionId: s.id }); assert.equal(calls[0].session.localTime, '2026-11-25 14:00:00'); assert.equal(calls[0].session.energyLevel, 'Low'); assert.equal(out.run.session.focusSessionId, s.id);
    assert.equal(await code(runs.create('u2', { focusSessionId: s.id })), '404:not_found');
  });
  test('history lists newest first and only the caller\'s runs; detail is owner-scoped', async () => {
    const { tasks, runs } = fixture(rankAll); await tasks.create('u1', TASK); await tasks.create('u2', TASK);
    const a = await runs.create('u1', SESSION); await runs.create('u2', SESSION); const b = await runs.create('u1', { ...SESSION, topK: 1 });
    const h = await runs.history('u1', { page: 1, pageSize: 10 }); assert.equal(h.total, 2); assert.equal(h.items[0].id, b.run.id); assert.equal(h.items[0].topRecommendation.taskName, 'T');
    assert.equal((await runs.detail('u1', a.run.id)).ranked.length, 1); assert.equal(await code(runs.detail('u2', a.run.id)), '404:not_found');
  });
});
