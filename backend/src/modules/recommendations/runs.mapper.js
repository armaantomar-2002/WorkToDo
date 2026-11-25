'use strict';
const { formatLocalDateTime, toIso } = require('../../utils/dates');

const summaryOf = (r) => ({ totalTasks: r.totalTasks, eligible: r.eligibleTasks, excluded: r.excludedTasks, returned: r.returnedTasks, startableNow: r.startableTasks });
const sessionOf = (r) => ({
  focusSessionId: r.focusSessionId ?? null, localTime: formatLocalDateTime(r.sessionDateTime), availableTimeMinutes: r.availableTimeMinutes,
  longestFreeSlotMinutes: r.longestFreeSlotMinutes, currentTimePeriod: r.currentTimePeriod, energyLevel: r.energyLevel, focusLevel: r.focusLevel,
});
const snap = (item) => (item.taskSnapshot && typeof item.taskSnapshot === 'object' ? item.taskSnapshot : {});

const toItem = (i, feedback = null) => ({
  itemId: i.id, feedback, rank: i.rank, taskId: i.taskId ?? null, taskName: i.taskNameSnapshot, taskDeleted: i.taskId === null,
  mlScore: i.mlScore, category: i.category, startableNow: i.startableNow, reason: i.reason,
  urgency: i.urgency, importance: i.importance, goalContribution: i.goalContribution, feasibility: i.feasibility,
  consequenceOfDelay: i.consequenceOfDelay, timingSuitability: i.timingSuitability, energySuitability: i.energySuitability,
  dueDate: snap(i).dueDate ?? null, estimatedDurationMinutes: snap(i).estimatedDurationMinutes ?? null,
});
const toExclusion = (e) => ({ taskId: e.taskId ?? null, taskName: e.taskNameSnapshot, taskDeleted: e.taskId === null, exclusionReason: e.exclusionReason });

/** Full run (with items + exclusions) -> API shape, built only from persisted data (history snapshots, not live tasks). */
function toRunDetail(run, feedbackByItem = new Map()) {
  return {
    run: { id: run.id, createdAt: toIso(run.createdAt), topK: run.topK ?? null, session: sessionOf(run), summary: summaryOf(run) },
    ranked: [...run.items].sort((a, b) => a.rank - b.rank).map((i) => toItem(i, feedbackByItem.get(i.id) ?? null)),
    excluded: run.exclusions.map(toExclusion),
  };
}
/** List row: run metadata + the top-ranked item (if any). */
function toRunListItem(run) {
  const top = run.items && run.items[0] ? run.items[0] : null;
  return {
    id: run.id, createdAt: toIso(run.createdAt), topK: run.topK ?? null, session: sessionOf(run), summary: summaryOf(run),
    topRecommendation: top ? { taskName: top.taskNameSnapshot, mlScore: top.mlScore, category: top.category, startableNow: top.startableNow } : null,
  };
}
module.exports = { toRunDetail, toRunListItem, toItem, summaryOf, sessionOf };
