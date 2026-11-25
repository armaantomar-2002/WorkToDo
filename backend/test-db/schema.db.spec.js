'use strict';
// Real PostgreSQL: constraints, uniqueness, cascades and SET NULL behaviour of the Prisma schema + migration.
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createPrismaClient } = require('../src/db/prisma');
const { testConfig, resetDatabase } = require('./helpers');

let prisma; let user;
const taskData = (o = {}) => ({ userId: user.id, taskName: 'T', importance: 'High', importanceRank: 2, goalContribution: 'High', consequenceOfDelay: 'Major', complexity: 'Simple', estimatedDurationMinutes: 30, ...o });
const rejects = async (promise, pattern) => { await assert.rejects(promise, (e) => { assert.match(String(e.message), pattern); return true; }); };

before(async () => { prisma = createPrismaClient(testConfig()); });
after(async () => { await resetDatabase(prisma); await prisma.$disconnect(); });
beforeEach(async () => { await resetDatabase(prisma); user = await prisma.user.create({ data: { fullName: 'U', email: 'u@example.com', passwordHash: 'x', preferences: { create: {} } } }); });

describe('CHECK constraints mirror the ML contract', () => {
  test('valid task is accepted with defaults', async () => {
    const t = await prisma.task.create({ data: taskData() });
    assert.equal(t.status, 'Pending'); assert.equal(t.preferredTime, 'Anytime'); assert.equal(t.dependencyStatus, 'No dependency'); assert.equal(t.deletedAt, null);
  });
  for (const [name, patch] of [
    ['importance', { importance: 'Urgent' }], ['importanceRank', { importanceRank: 9 }], ['goalContribution', { goalContribution: 'Huge' }], ['consequenceOfDelay', { consequenceOfDelay: 'No consequence' }],
    ['complexity', { complexity: 'Hard' }], ['preferredTime', { preferredTime: 'Noon' }], ['dependencyStatus', { dependencyStatus: 'Maybe' }], ['status', { status: 'Done' }],
    ['duration', { estimatedDurationMinutes: 0 }], ['minimumSession > duration', { minimumSessionMinutes: 31 }], ['dueDate < startDate', { startDate: new Date('2026-12-05'), dueDate: new Date('2026-12-01') }],
  ]) test(`rejects invalid task ${name}`, async () => { await rejects(prisma.task.create({ data: taskData(patch) }), /check constraint|Check constraint|violates/i); });
  test('rejects invalid focus session and preference values', async () => {
    const base = { userId: user.id, sessionDateTime: new Date('2026-11-24T09:00:00Z'), availableTimeMinutes: 60, longestFreeSlotMinutes: 30, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High' };
    await prisma.focusSession.create({ data: base });
    await rejects(prisma.focusSession.create({ data: { ...base, longestFreeSlotMinutes: 61 } }), /check constraint|violates/i);
    await rejects(prisma.focusSession.create({ data: { ...base, energyLevel: 'Extreme' } }), /check constraint|violates/i);
    await rejects(prisma.userPreferences.update({ where: { userId: user.id }, data: { themePreference: 'neon' } }), /check constraint|violates/i);
    await rejects(prisma.userPreferences.update({ where: { userId: user.id }, data: { notificationPreference: 'sometimes' } }), /check constraint|violates/i);
  });
});

describe('uniqueness, cascades and history integrity', () => {
  test('email is unique', async () => { await rejects(prisma.user.create({ data: { fullName: 'X', email: 'u@example.com', passwordHash: 'x' } }), /Unique constraint/i); });
  test('deleting a user cascades to everything they own', async () => {
    await prisma.task.create({ data: taskData() }); await prisma.authSession.create({ data: { userId: user.id, familyId: '11111111-1111-4111-8111-111111111111', refreshTokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 1e6) } });
    await prisma.user.delete({ where: { id: user.id } });
    assert.equal(await prisma.task.count(), 0); assert.equal(await prisma.authSession.count(), 0); assert.equal(await prisma.userPreferences.count(), 0);
  });
  test('run history survives hard deletion of its task and focus session (SET NULL + snapshots)', async () => {
    const task = await prisma.task.create({ data: taskData({ taskName: 'Keep my name' }) });
    const fs = await prisma.focusSession.create({ data: { userId: user.id, sessionDateTime: new Date('2026-11-24T09:00:00Z'), availableTimeMinutes: 60, longestFreeSlotMinutes: 30, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High' } });
    const f = { urgency: 1, importance: 1, goalContribution: 1, feasibility: 1, consequenceOfDelay: 1, timingSuitability: 1, energySuitability: 1 };
    const run = await prisma.recommendationRun.create({ data: { userId: user.id, focusSessionId: fs.id, sessionDateTime: fs.sessionDateTime, availableTimeMinutes: 60, longestFreeSlotMinutes: 30, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High', totalTasks: 1, eligibleTasks: 1, excludedTasks: 0, returnedTasks: 1, startableTasks: 1, items: { create: [{ taskId: task.id, taskNameSnapshot: 'Keep my name', taskSnapshot: { taskName: 'Keep my name' }, rank: 1, mlScore: 88.5, category: 'Do now', startableNow: true, reason: 'r', ...f }] } } });
    await prisma.task.delete({ where: { id: task.id } }); await prisma.focusSession.delete({ where: { id: fs.id } });
    const after = await prisma.recommendationRun.findUnique({ where: { id: run.id }, include: { items: true } });
    assert.equal(after.focusSessionId, null); assert.equal(after.items[0].taskId, null); assert.equal(after.items[0].taskNameSnapshot, 'Keep my name'); assert.equal(after.items[0].mlScore, 88.5);
  });
  test('a run cannot hold two items with the same rank, nor the same task twice, nor a score outside 0-100', async () => {
    const task = await prisma.task.create({ data: taskData() }); const task2 = await prisma.task.create({ data: taskData({ taskName: 'T2' }) });
    const f = { urgency: 1, importance: 1, goalContribution: 1, feasibility: 1, consequenceOfDelay: 1, timingSuitability: 1, energySuitability: 1 };
    const run = await prisma.recommendationRun.create({ data: { userId: user.id, sessionDateTime: new Date('2026-11-24T09:00:00Z'), availableTimeMinutes: 60, longestFreeSlotMinutes: 30, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High', totalTasks: 2, eligibleTasks: 2, excludedTasks: 0, returnedTasks: 2, startableTasks: 2 } });
    const item = (o) => ({ recommendationRunId: run.id, taskNameSnapshot: 'x', taskSnapshot: {}, startableNow: true, reason: 'r', category: 'Do now', mlScore: 50, ...f, ...o });
    await prisma.recommendationItem.create({ data: item({ taskId: task.id, rank: 1 }) });
    await rejects(prisma.recommendationItem.create({ data: item({ taskId: task2.id, rank: 1 }) }), /Unique constraint/i);
    await rejects(prisma.recommendationItem.create({ data: item({ taskId: task.id, rank: 2 }) }), /Unique constraint/i);
    await rejects(prisma.recommendationItem.create({ data: item({ taskId: task2.id, rank: 2, mlScore: 101 }) }), /check constraint|violates/i);
  });
  test('wall-clock session times and DATE columns round-trip without any shift', async () => {
    const s = await prisma.focusSession.create({ data: { userId: user.id, sessionDateTime: new Date(Date.UTC(2026, 2, 8, 2, 30, 0)), availableTimeMinutes: 60, longestFreeSlotMinutes: 30, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High' } });
    const back = await prisma.focusSession.findUnique({ where: { id: s.id } }); assert.equal(back.sessionDateTime.toISOString(), '2026-03-08T02:30:00.000Z');
    const t = await prisma.task.create({ data: taskData({ dueDate: new Date(Date.UTC(2026, 11, 31)) }) }); assert.equal((await prisma.task.findUnique({ where: { id: t.id } })).dueDate.toISOString().slice(0, 10), '2026-12-31');
  });
});
