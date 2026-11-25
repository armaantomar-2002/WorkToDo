'use strict';
const { AppError } = require('../../errors/AppError');
const { parseLocalDateTime } = require('../../utils/dates');
const { toPublicTask, toRecommendationTask } = require('../tasks/tasks.mapper');
const { toPublicSession } = require('../sessions/sessions.service');
const { toRunDetail, toRunListItem } = require('./runs.mapper');
const deps = require('../tasks/dependencies');
const { createFeedbackService } = require('./feedback.service');
const { MAX_TASKS_PER_REQUEST } = require('../../validators/recommendationRequest');

const ACTIVE = ['Pending', 'In Progress'];
const INACTIVE_CONTEXT_LIMIT = 25; // newest Completed/Cancelled tasks included so Python reports them as "Task not active"
const notFound = () => new AppError({ status: 404, code: 'not_found', message: 'Recommendation run not found' });
const unprocessable = (code, message, errors) => new AppError({ status: 422, code, message, errors });

/**
 * Generates and persists a recommendation run. Scoring/ranking/categories come ONLY from the existing Python pipeline
 * (`recommendationService.recommend`: validate -> map -> ML -> validate response). Nothing is saved unless that fully succeeds.
 */
function createRunsService({ prisma, recommendationService }) {
  const feedback = createFeedbackService({ prisma });
  return {
    async create(userId, input) {
      let session;
      let focusSessionId = null;
      if (input.focusSessionId) {
        const row = await prisma.focusSession.findFirst({ where: { id: input.focusSessionId.toLowerCase(), userId } });
        if (!row) throw new AppError({ status: 404, code: 'not_found', message: 'Focus session not found' });
        const s = toPublicSession(row);
        focusSessionId = row.id;
        session = { localTime: s.sessionDateTime, availableTimeMinutes: s.availableTimeMinutes, longestFreeSlotMinutes: s.longestFreeSlotMinutes, currentTimePeriod: s.currentTimePeriod, energyLevel: s.energyLevel, focusLevel: s.focusLevel };
      } else {
        session = { localTime: input.localTime, availableTimeMinutes: input.availableTimeMinutes, longestFreeSlotMinutes: input.longestFreeSlotMinutes, currentTimePeriod: input.currentTimePeriod, energyLevel: input.energyLevel, focusLevel: input.focusLevel };
      }

      const base = { userId, deletedAt: null };
      const active = await prisma.task.findMany({ where: { ...base, status: { in: ACTIVE } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (active.length === 0) throw unprocessable('no_active_tasks', 'Add at least one Pending or In Progress task before generating recommendations');
      if (active.length > MAX_TASKS_PER_REQUEST) throw unprocessable('too_many_tasks', `You have ${active.length} active tasks; at most ${MAX_TASKS_PER_REQUEST} can be ranked at once. Complete or archive some tasks first.`);
      const room = Math.min(INACTIVE_CONTEXT_LIMIT, MAX_TASKS_PER_REQUEST - active.length);
      const inactive = room > 0
        ? await prisma.task.findMany({ where: { ...base, status: { notIn: ACTIVE } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: room })
        : [];
      const picked = [...active, ...inactive];
      // dependencyStatus is derived from real task dependencies, using exactly the values the Python contract expects.
      const derived = await deps.derivedStatusesFor(prisma, userId, picked.map((t) => t.id));
      const tasks = picked.map((t) => ({ ...t, dependencyStatus: derived.get(t.id) ?? 'No dependency' }));
      const byId = new Map(tasks.map((t) => [t.id, t]));

      const request = { session, tasks: tasks.map(toRecommendationTask) };
      if (input.topK !== undefined) request.topK = input.topK;
      const result = await recommendationService.recommend(request); // may throw AppError(422/502/503/504): nothing has been written

      // Integrity: every id returned by Python must be one we sent, exactly once.
      const seen = new Set();
      for (const id of [...result.ranked.map((r) => r.taskId), ...result.excluded.map((e) => e.taskId)]) {
        if (!byId.has(id) || seen.has(id)) throw new AppError({ status: 502, code: 'ml_invalid_response', message: 'The recommendation service returned an invalid response.', logContext: { contractViolation: 'unknown or duplicate task id' } });
        seen.add(id);
      }

      const snapshotOf = (id) => toPublicTask(byId.get(id));
      const run = await prisma.recommendationRun.create({
        data: {
          userId, focusSessionId, sessionDateTime: parseLocalDateTime(session.localTime), availableTimeMinutes: session.availableTimeMinutes,
          longestFreeSlotMinutes: session.longestFreeSlotMinutes, currentTimePeriod: session.currentTimePeriod, energyLevel: session.energyLevel, focusLevel: session.focusLevel,
          topK: input.topK ?? null, totalTasks: result.summary.totalTasks, eligibleTasks: result.summary.eligible, excludedTasks: result.summary.excluded,
          returnedTasks: result.summary.returned, startableTasks: result.summary.startableNow,
          items: { create: result.ranked.map((r) => ({
            taskId: r.taskId, taskNameSnapshot: byId.get(r.taskId).taskName, taskSnapshot: snapshotOf(r.taskId), rank: r.rank, mlScore: r.mlScore, category: r.category,
            startableNow: r.startableNow, reason: r.reason, urgency: r.urgency, importance: r.importance, goalContribution: r.goalContribution, feasibility: r.feasibility,
            consequenceOfDelay: r.consequenceOfDelay, timingSuitability: r.timingSuitability, energySuitability: r.energySuitability,
          })) },
          exclusions: { create: result.excluded.map((e) => ({ taskId: e.taskId, taskNameSnapshot: byId.get(e.taskId).taskName, taskSnapshot: snapshotOf(e.taskId), exclusionReason: String(e.exclusionReason).slice(0, 100) })) },
        },
        include: { items: true, exclusions: true },
      }); // nested create = one atomic transaction (run + items + exclusions)
      return toRunDetail(run);
    },

    async history(userId, { page, pageSize }) {
      const where = { userId };
      const [total, rows] = await Promise.all([
        prisma.recommendationRun.count({ where }),
        prisma.recommendationRun.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, include: { items: { where: { rank: 1 }, take: 1 } } }),
      ]);
      return { items: rows.map(toRunListItem), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
    },

    async detail(userId, id) {
      const run = await prisma.recommendationRun.findFirst({ where: { id, userId }, include: { items: true, exclusions: true } });
      if (!run) throw notFound();
      return toRunDetail(run, await feedback.forRun(prisma, userId, id));
    },
  };
}
module.exports = { createRunsService, INACTIVE_CONTEXT_LIMIT };
