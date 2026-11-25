'use strict';
const { toAbs } = require('../scheduler/time');

/** Dashboard planner block. Only reports what the data supports: nothing is estimated when no schedule exists. */
function createPlannerSummary({ calendar, schedule, prisma, now = () => new Date() }) {
  return async function summary(userId) {
    const today = await calendar.today(userId);
    const cal = await calendar.range(userId, { from: today, to: today });
    const approved = await schedule.getOpen(userId, 'approved');
    const draft = cal.draftId ? { id: cal.draftId } : null;
    const nowAbs = toAbs(cal.now);
    const todays = cal.approvedBlocks.filter((b) => b.start.slice(0, 10) === today);
    const nextBlock = cal.approvedBlocks.filter((b) => b.kind === 'task' && b.status === 'planned' && toAbs(b.end) > nowAbs).sort((a, b) => (a.start < b.start ? -1 : 1))[0] ?? null;
    const nextAppt = await prisma.appointment.findFirst({ where: { userId, status: 'scheduled', endAt: { gt: new Date(nowAbs * 60000) } }, orderBy: [{ startAt: 'asc' }, { id: 'asc' }] });
    const day = cal.days[0];
    const dueToday = cal.deadlines.filter((d) => d.dueDate === today && ['Pending', 'In Progress'].includes(d.status));
    let status = 'none';
    if (approved) status = approved.needsRecalculation ? 'needs_recalculation' : 'approved';
    return {
      today, now: cal.now, scheduleStatus: status, hasDraft: !!draft, draftId: draft?.id ?? null, approvedId: cal.approvedId,
      nextBlock, nextAppointment: nextAppt ? { id: nextAppt.id, title: nextAppt.title, startAt: nextAppt.startAt.toISOString().slice(0, 16), endAt: nextAppt.endAt.toISOString().slice(0, 16), location: nextAppt.location ?? null } : null,
      todaysBlocks: todays, appointmentsToday: cal.appointments.filter((a) => a.startAt.slice(0, 10) === today),
      dueToday: dueToday.map((d) => ({ taskId: d.taskId, taskName: d.taskName })), plannedMinutesToday: day?.plannedMinutes ?? 0, actualMinutesToday: day?.actualMinutes ?? 0, freeMinutesToday: day?.freeMinutes ?? 0,
      workingToday: !!day?.working, unscheduledCount: approved ? approved.unscheduled.length : null, completedToday: cal.completions.filter((c) => c.completedOn === today).length,
    };
  };
}
module.exports = { createPlannerSummary };
