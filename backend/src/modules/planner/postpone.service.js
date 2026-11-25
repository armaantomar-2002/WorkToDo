'use strict';
const { AppError } = require('../../errors/AppError');
const { toIso } = require('../../utils/dates');
const { lockUser } = require('./appointments.service');
const { nowWall, safeZone, formatDateOnly, dateOnly, addDays } = require('./wall');

const ACTIVE = ['Pending', 'In Progress'];
const out = (p) => ({ id: p.id, taskId: p.taskId, originalDueDate: formatDateOnly(p.originalDueDate), previousPostponedUntil: formatDateOnly(p.previousPostponedUntil), newPostponedUntil: formatDateOnly(p.newPostponedUntil), reason: p.reason ?? null, createdAt: toIso(p.createdAt) });

/**
 * Postponing never edits the deadline: `dueDate` stays as the original commitment; `postponedUntil` records the new intended earliest date and
 * every change is written to TaskPostponement. Urgency is a function of the (unchanged) due date, so repeated postponement cannot inflate it; the
 * count is stored for personalisation/insights only. The approved schedule is not rewritten: it is reported as needing recalculation.
 */
function createPostponeService({ prisma, now = () => new Date() }) {
  return {
    async postpone(userId, taskId, { days = 1, reason, confirm = false } = {}) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const task = await tx.task.findFirst({ where: { id: taskId, userId, deletedAt: null } });
        if (!task) throw new AppError({ status: 404, code: 'not_found', message: 'Task not found' });
        if (!ACTIVE.includes(task.status)) throw new AppError({ status: 409, code: 'invalid_transition', message: `A ${task.status} task cannot be postponed.` });
        const prefs = await tx.userPreferences.findUnique({ where: { userId } });
        const today = nowWall(now(), safeZone(prefs?.timeZone)).slice(0, 10);
        const current = formatDateOnly(task.postponedUntil);
        const base = current && current > today ? current : today;
        const next = addDays(base, days);
        const due = formatDateOnly(task.dueDate);
        if (due && next > due && !confirm) {
          throw new AppError({ status: 409, code: 'confirmation_required', message: `Postponing to ${next} is after the deadline (${due}). The deadline itself will not change. Confirm to continue.`, errors: [{ field: 'confirm', message: `new date ${next} is after the deadline ${due}` }] });
        }
        const prevCount = task.postponeCount; const prevUntil = task.postponedUntil ?? null; const nextCount = prevCount + 1;
        const claimed = await tx.task.updateMany({ where: { id: taskId, userId, deletedAt: null, status: { in: ACTIVE }, postponeCount: prevCount }, data: { postponedUntil: dateOnly(next), postponeCount: nextCount } });
        if (claimed.count !== 1) throw new AppError({ status: 409, code: 'concurrent_update', message: 'This task was changed at the same time. Reload and try again.' });
        const row = await tx.taskPostponement.create({ data: { userId, taskId, originalDueDate: task.dueDate ?? null, previousPostponedUntil: prevUntil, newPostponedUntil: dateOnly(next), reason: reason ?? null } });
        return { postponement: out(row), task: { id: taskId, dueDate: due, postponedUntil: next, postponeCount: nextCount }, needsRecalculation: true, pastDeadline: !!(due && next > due) };
      });
    },
    async history(userId, taskId) {
      const t = await prisma.task.findFirst({ where: { id: taskId, userId } });
      if (!t) throw new AppError({ status: 404, code: 'not_found', message: 'Task not found' });
      const rows = await prisma.taskPostponement.findMany({ where: { taskId, userId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
      return { postponeCount: t.postponeCount ?? 0, history: rows.map(out) };
    },
  };
}
module.exports = { createPostponeService };
