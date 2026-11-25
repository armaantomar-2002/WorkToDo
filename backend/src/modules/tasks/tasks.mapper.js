'use strict';
const { formatDateOnly, toIso } = require('../../utils/dates');

const toPublicTask = (t) => ({
  id: t.id, taskName: t.taskName, description: t.description ?? null,
  startDate: formatDateOnly(t.startDate), dueDate: formatDateOnly(t.dueDate),
  importance: t.importance, goalContribution: t.goalContribution, consequenceOfDelay: t.consequenceOfDelay, complexity: t.complexity,
  estimatedDurationMinutes: t.estimatedDurationMinutes, minimumSessionMinutes: t.minimumSessionMinutes ?? null, isSplittable: t.isSplittable,
  preferredTime: t.preferredTime, dependencyStatus: t.dependencyStatus, status: t.status,
  postponedUntil: formatDateOnly(t.postponedUntil), postponeCount: t.postponeCount ?? 0,
  createdAt: toIso(t.createdAt), updatedAt: toIso(t.updatedAt), completedAt: toIso(t.completedAt),
});

/** DB task -> the existing Node recommendation request task (camelCase). The existing validator/mapper then produce the Python contract. */
function toRecommendationTask(t) {
  const task = {
    taskId: t.id, taskName: t.taskName, importance: t.importance, goalContribution: t.goalContribution, consequenceOfDelay: t.consequenceOfDelay,
    complexity: t.complexity, estimatedDurationMinutes: t.estimatedDurationMinutes, isSplittable: t.isSplittable, preferredTime: t.preferredTime,
    dependencyStatus: t.dependencyStatus, status: t.status,
  };
  // A postponed task is not eligible before its new intended date: effective start = the later of start date and postponed-until.
  const effStart = [formatDateOnly(t.startDate), formatDateOnly(t.postponedUntil)].filter(Boolean).sort().pop();
  if (effStart) task.startDate = effStart;
  if (t.dueDate) task.dueDate = formatDateOnly(t.dueDate);
  if (t.isSplittable && t.minimumSessionMinutes != null) task.minimumSessionMinutes = t.minimumSessionMinutes;
  return task;
}
module.exports = { toPublicTask, toRecommendationTask };
