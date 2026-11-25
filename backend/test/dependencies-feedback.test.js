'use strict';
// Task-dependency and recommendation-feedback tests. Graph/derivation maths are pure. Service tests use the in-memory Prisma
// STAND-IN (not proof of Prisma/PostgreSQL behaviour: composite FKs, unique indexes and cascades are verified by test-db/ and migration SQL).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const dep = require('../src/modules/tasks/dependencies');
const { createTasksService } = require('../src/modules/tasks/tasks.service');
const { createRunsService } = require('../src/modules/recommendations/runs.service');
const { createFeedbackService, feedbackInput } = require('../src/modules/recommendations/feedback.service');
const { createMemoryPrisma } = require('../test-support/memoryPrisma');
const { AppError } = require('../src/errors/AppError');
const { toRecommendationTask } = require('../src/modules/tasks/tasks.mapper');

const code = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof AppError, String(e && e.stack)); return `${e.status}:${e.code}`; } return 'no-error'; };
const A = '00000000-0000-4000-8000-00000000000a'; const B = '00000000-0000-4000-8000-00000000000b';

describe('dependency maths (pure)', () => {
  test('deriveStatus uses exactly the three Python contract values', () => {
    assert.equal(dep.deriveStatus([]), 'No dependency');
    assert.equal(dep.deriveStatus([{ status: 'Pending' }]), 'Blocked');
    assert.equal(dep.deriveStatus([{ status: 'In Progress' }, { status: 'Completed' }]), 'Blocked');
    assert.equal(dep.deriveStatus([{ status: 'Completed' }, { status: 'Cancelled' }]), 'Ready');
    assert.equal(dep.deriveStatus([{ status: 'Pending', deletedAt: new Date() }]), 'No dependency', 'deleted prerequisites are ignored');
    assert.equal(dep.deriveStatus([{ status: 'Pending', deletedAt: new Date() }, { status: 'Completed' }]), 'Ready');
  });
  test('wouldCreateCycle: self, direct, transitive, diamonds are fine', () => {
    const g = new Map([['b', ['a']], ['c', ['b']]]); // c needs b, b needs a
    assert.equal(dep.wouldCreateCycle(g, 'a', 'a'), true);
    assert.equal(dep.wouldCreateCycle(g, 'a', 'b'), true);   // a needs b, but b needs a
    assert.equal(dep.wouldCreateCycle(g, 'a', 'c'), true);   // transitive a -> c -> b -> a
    assert.equal(dep.wouldCreateCycle(g, 'c', 'a'), false);  // redundant but acyclic
    assert.equal(dep.wouldCreateCycle(g, 'd', 'c'), false);
    const diamond = new Map([['b', ['a']], ['c', ['a']]]); assert.equal(dep.wouldCreateCycle(diamond, 'd', 'b'), false);
    assert.equal(dep.wouldCreateCycle(new Map([['x', ['y']], ['y', ['x']]]), 'z', 'x'), false, 'terminates on an existing (corrupt) loop that does not involve the task');
  });
});

function fixture() {
  const prisma = createMemoryPrisma(); const tasks = createTasksService({ prisma, now: () => new Date('2026-11-24T10:00:00Z') }); const deps = dep.createDependenciesService({ prisma });
  let n = 0;
  const mk = (userId, name, extra = {}) => { const row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, userId, taskName: name, importance: 'High', importanceRank: 2, goalContribution: 'High', consequenceOfDelay: 'Major', complexity: 'Simple', estimatedDurationMinutes: 30, isSplittable: false, preferredTime: 'Anytime', dependencyStatus: 'No dependency', status: 'Pending', deletedAt: null, completedAt: null, startDate: null, dueDate: null, createdAt: new Date(n), updatedAt: new Date(n), ...extra }; prisma._tables.task = prisma._tables.task ?? []; prisma._tables.task.push(row); return row; };
  return { prisma, tasks, deps, mk };
}

describe('task dependencies (service logic, stand-in Prisma)', () => {
  test('add -> Blocked; completing the prerequisite -> Ready; reopening -> Blocked again; remove -> No dependency', async () => {
    const { tasks, deps, mk } = fixture(); const pre = mk(A, 'pre'); const t = mk(A, 'main');
    let v = await deps.add(A, t.id, pre.id); assert.equal(v.dependencyStatus, 'Blocked'); assert.equal(v.prerequisites[0].taskName, 'pre'); assert.equal(v.prerequisites[0].isBlocking, true);
    assert.equal(t.dependencyStatus, 'Blocked');
    await tasks.setStatus(A, pre.id, { status: 'Completed' }); assert.equal(t.dependencyStatus, 'Ready');
    await tasks.update(A, pre.id, { status: 'In Progress' }); assert.equal(t.dependencyStatus, 'Blocked');
    await tasks.setStatus(A, pre.id, { status: 'Cancelled' }); assert.equal(t.dependencyStatus, 'Ready');
    v = await deps.remove(A, t.id, pre.id); assert.equal(v.dependencyStatus, 'No dependency'); assert.equal(v.prerequisites.length, 0);
    assert.equal(await code(deps.remove(A, t.id, pre.id)), '404:not_found');
  });
  test('deleting a prerequisite unblocks its dependents and removes the edges', async () => {
    const { prisma, tasks, deps, mk } = fixture(); const pre = mk(A, 'pre'); const t = mk(A, 'main'); await deps.add(A, t.id, pre.id);
    await tasks.remove(A, pre.id); assert.equal(t.dependencyStatus, 'No dependency'); assert.equal(prisma._tables.taskDependency.length, 0); assert.equal(pre.deletedAt instanceof Date, true);
  });
  test('rejects self, duplicate, cycles (direct and transitive) and over-long chains of prerequisites', async () => {
    const { deps, mk } = fixture(); const a = mk(A, 'a'); const b = mk(A, 'b'); const c = mk(A, 'c');
    assert.equal(await code(deps.add(A, a.id, a.id)), '422:self_dependency');
    await deps.add(A, b.id, a.id); await deps.add(A, c.id, b.id);
    assert.equal(await code(deps.add(A, b.id, a.id)), '409:dependency_exists');
    assert.equal(await code(deps.add(A, a.id, b.id)), '422:circular_dependency');
    assert.equal(await code(deps.add(A, a.id, c.id)), '422:circular_dependency');
    const hub = mk(A, 'hub'); for (let i = 0; i < dep.MAX_PREREQUISITES; i++) await deps.add(A, hub.id, mk(A, `p${i}`).id);
    assert.equal(await code(deps.add(A, hub.id, mk(A, 'one-too-many').id)), '422:too_many_dependencies');
  });
  test('ownership: cannot link to, read or edit other users\' tasks', async () => {
    const { deps, mk } = fixture(); const mine = mk(A, 'mine'); const theirs = mk(B, 'theirs');
    assert.equal(await code(deps.add(A, mine.id, theirs.id)), '422:invalid_prerequisite');
    assert.equal(await code(deps.add(A, theirs.id, mine.id)), '404:not_found');
    assert.equal(await code(deps.list(A, theirs.id)), '404:not_found');
    assert.equal(await code(deps.remove(A, theirs.id, mine.id)), '404:not_found');
  });
  test('task create/update no longer accepts a client-supplied dependencyStatus', () => {
    const v = require('../src/modules/tasks/tasks.validator');
    const base = { taskName: 'x', importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Major', complexity: 'Simple', estimatedDurationMinutes: 10 };
    assert.throws(() => v.createInput({ ...base, dependencyStatus: 'Blocked' }), (e) => e.status === 422);
    assert.throws(() => v.dependencyInput({ dependsOnTaskId: 'nope' }), (e) => e.status === 422);
  });
  test('recommendation runs send DERIVED statuses and exactly one ML call; blocked tasks arrive as "Blocked"', async () => {
    const { prisma, deps, mk } = fixture(); const pre = mk(A, 'pre'); const t = mk(A, 'main'); await deps.add(A, t.id, pre.id); t.dependencyStatus = 'No dependency'; // stored value deliberately stale
    prisma._tables.recommendationRun = []; prisma.recommendationRun.create = async ({ data }) => ({ id: 'r1', createdAt: new Date(), ...data, items: [], exclusions: [] });
    const sent = [];
    const recommendationService = { recommend: async (req) => { sent.push(req); return { summary: { totalTasks: 2, eligible: 1, excluded: 1, returned: 1, startableNow: 1 }, ranked: [{ rank: 1, taskId: pre.id, mlScore: 50, category: 'Do now', startableNow: true, reason: 'r', urgency: 1, importance: 1, goalContribution: 1, feasibility: 1, consequenceOfDelay: 1, timingSuitability: 1, energySuitability: 1 }], excluded: [{ taskId: t.id, exclusionReason: 'Dependency blocked' }] }; } };
    const runs = createRunsService({ prisma, recommendationService });
    await runs.create(A, { localTime: '2026-11-24 10:00:00', availableTimeMinutes: 60, longestFreeSlotMinutes: 60, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High' });
    assert.equal(sent.length, 1); const byName = Object.fromEntries(sent[0].tasks.map((x) => [x.taskName, x.dependencyStatus]));
    assert.deepEqual(byName, { pre: 'No dependency', main: 'Blocked' });
    assert.ok(['No dependency', 'Ready', 'Blocked'].includes(toRecommendationTask(t).dependencyStatus));
  });
});

describe('recommendation feedback (service logic, stand-in Prisma)', () => {
  function fb() {
    const { prisma } = fixture(); const feedback = createFeedbackService({ prisma });
    const run = (userId, id) => { prisma._tables.recommendationRun = prisma._tables.recommendationRun ?? []; prisma._tables.recommendationRun.push({ id, userId }); };
    const item = (runId, id, taskId = null) => prisma._tables.recommendationItem.push({ id, recommendationRunId: runId, taskId });
    prisma._tables.recommendationItem = prisma._tables.recommendationItem ?? [];
    run(A, 'aaaaaaaa-0000-4000-8000-000000000001'); run(B, 'bbbbbbbb-0000-4000-8000-000000000001');
    item('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'cccccccc-0000-4000-8000-000000000001');
    item('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-0000000000b1');
    return { prisma, feedback, RA: 'aaaaaaaa-0000-4000-8000-000000000001', IA: 'aaaaaaaa-0000-4000-8000-0000000000a1', RB: 'bbbbbbbb-0000-4000-8000-000000000001', IB: 'bbbbbbbb-0000-4000-8000-0000000000b1' };
  }
  test('create, replace (one row per item), read back via forRun, delete', async () => {
    const { prisma, feedback, RA, IA } = fb();
    const first = await feedback.put(A, RA, IA, { feedbackType: 'helpful', comment: 'good pick' }); assert.equal(first.feedbackType, 'helpful'); assert.equal(first.comment, 'good pick');
    await feedback.put(A, RA, IA, { feedbackType: 'not_helpful', comment: '' }); assert.equal(prisma._tables.recommendationFeedback.length, 1);
    const row = prisma._tables.recommendationFeedback[0]; assert.equal(row.feedbackType, 'not_helpful'); assert.equal(row.comment, null); assert.equal(row.taskId, 'cccccccc-0000-4000-8000-000000000001');
    assert.equal((await feedback.forRun(prisma, A, RA)).get(IA).feedbackType, 'not_helpful');
    await feedback.remove(A, RA, IA); assert.equal(prisma._tables.recommendationFeedback.length, 0); assert.equal(await code(feedback.remove(A, RA, IA)), '404:not_found');
  });
  test('a user cannot give feedback on, or read feedback for, another user\'s run/item; item must belong to the run', async () => {
    const { prisma, feedback, RA, IA, RB, IB } = fb();
    assert.equal(await code(feedback.put(B, RA, IA, { feedbackType: 'helpful' })), '404:not_found');
    assert.equal(await code(feedback.put(A, RB, IB, { feedbackType: 'helpful' })), '404:not_found');
    assert.equal(await code(feedback.put(A, RA, IB, { feedbackType: 'helpful' })), '404:not_found'); // mismatched item/run
    assert.equal(await code(feedback.remove(B, RA, IA)), '404:not_found');
    await feedback.put(A, RA, IA, { feedbackType: 'helpful' }); assert.equal((await feedback.forRun(prisma, B, RA)).size, 0);
  });
  test('validation: type enum, comment length, unknown fields', () => {
    assert.throws(() => feedbackInput({ feedbackType: 'love_it' }), (e) => e.status === 422);
    assert.throws(() => feedbackInput({ feedbackType: 'helpful', comment: 'x'.repeat(501) }), (e) => e.status === 422);
    assert.throws(() => feedbackInput({ feedbackType: 'helpful', userId: 'x' }), (e) => e.status === 422);
    assert.throws(() => feedbackInput({}), (e) => e.status === 422);
    assert.deepEqual(feedbackInput({ feedbackType: 'already_done', comment: null }), { feedbackType: 'already_done', comment: null });
  });
});
