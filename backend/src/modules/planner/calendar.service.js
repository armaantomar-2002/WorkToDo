'use strict';
const { toIso } = require('../../utils/dates');
const { loadContext } = require('./context');
const { toAbs, fromAbs, DAY, dayOf, subtractIntervals, weekdayOf } = require('../scheduler/time');
const { toWall, fromWall, formatDateOnly, addDays } = require('./wall');

const mm = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const bufferedSpan = (a) => ({ start: toAbs(a.startAt) - a.preparationBufferMinutes - a.travelBufferMinutes, end: toAbs(a.endAt) + a.travelBufferMinutes });

/** One read model for the day, week and month calendar. Everything is scoped to the caller and expressed in the user's local wall clock. */
function createCalendarService({ prisma, now = () => new Date() }) {
  return {
    /** The user's current local date (their configured zone, default Asia/Kolkata). */
    async today(userId) { const { nowWall, safeZone } = require('./wall'); const p = await prisma.userPreferences.findUnique({ where: { userId } }); return nowWall(now(), safeZone(p?.timeZone)).slice(0, 10); },
    async range(userId, { from, to }) {
      const ctx = await loadContext(prisma, userId, now(), { from, to });
      const lo = fromWall(`${from}T00:00`); const hi = fromWall(`${addDays(to, 1)}T00:00`);
      const names = new Map(); const nameOf = async (ids) => { const need = ids.filter((i) => i && !names.has(i)); if (need.length) for (const t of await prisma.task.findMany({ where: { userId, id: { in: need } } })) names.set(t.id, t.taskName); };
      const versions = await prisma.scheduleVersion.findMany({ where: { userId, status: { in: ['approved', 'draft'] } } });
      const blocks = versions.length ? await prisma.scheduledBlock.findMany({ where: { userId, scheduleVersionId: { in: versions.map((v) => v.id) }, startAt: { lt: hi }, endAt: { gt: lo } }, orderBy: [{ startAt: 'asc' }, { id: 'asc' }] }) : [];
      await nameOf(blocks.map((b) => b.taskId));
      const statusOf = new Map(versions.map((v) => [v.id, v.status]));
      const shape = (b) => ({ id: b.id, scheduleVersionId: b.scheduleVersionId, kind: b.kind, taskId: b.taskId ?? null, taskName: b.kind === 'task' ? names.get(b.taskId) ?? b.taskNameSnapshot : 'Break', start: toWall(b.startAt), end: toWall(b.endAt), durationMinutes: Math.round((b.endAt - b.startAt) / 60000), status: b.status, source: b.source, sessionIndex: b.sessionIndex, sessionCount: b.sessionCount });
      const approvedBlocks = blocks.filter((b) => statusOf.get(b.scheduleVersionId) === 'approved').map(shape);
      const draftBlocks = blocks.filter((b) => statusOf.get(b.scheduleVersionId) === 'draft').map(shape);

      const dueRows = await prisma.task.findMany({ where: { userId, deletedAt: null, dueDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: 1000 });
      const deadlines = dueRows.map((t) => ({ taskId: t.id, taskName: t.taskName, dueDate: formatDateOnly(t.dueDate), status: t.status, importance: t.importance }));
      const doneRows = await prisma.task.findMany({ where: { userId, deletedAt: null, status: 'Completed', completedAt: { gte: new Date(lo.getTime() - 86400000), lt: new Date(hi.getTime() + 86400000) } }, take: 1000 });
      const timers = await prisma.focusTimer.findMany({ where: { userId, status: 'finished', startedAt: { gte: new Date(lo.getTime() - 86400000), lt: new Date(hi.getTime() + 86400000) } }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }], take: 1000 });
      // Timer instants are real instants; convert to the user's wall clock for display.
      const { nowWall } = require('./wall');
      const wall = (d) => nowWall(d, ctx.prefs.timeZone);
      const actual = timers.map((t) => ({ id: t.id, taskId: t.taskId ?? null, taskName: t.taskNameSnapshot ?? null, start: wall(t.startedAt), end: t.endedAt ? wall(t.endedAt) : null, minutes: Math.round((t.actualFocusedSeconds ?? 0) / 60), plannedMinutes: t.plannedDurationMinutes }));
      const completions = doneRows.map((t) => ({ taskId: t.id, taskName: t.taskName, completedOn: wall(t.completedAt).slice(0, 10) })).filter((c) => c.completedOn >= from && c.completedOn <= to);

      const wh = ctx.prefs.workingHours; const days = [];
      const busy = [...ctx.appointments.map(bufferedSpan), ...ctx.unavailable.map((u) => ({ start: toAbs(u.startAt), end: toAbs(u.endAt) })), ...approvedBlocks.map((b) => ({ start: toAbs(b.start), end: toAbs(b.end) }))];
      const nowAbs = toAbs(ctx.nowLocal);
      for (let d = dayOf(toAbs(`${from}T00:00`)); d <= dayOf(toAbs(`${to}T00:00`)); d++) {
        const key = fromAbs(d * DAY).slice(0, 10); const working = wh.days.includes(weekdayOf(d)) ? { start: wh.start, end: wh.end } : null;
        const win = working ? [{ start: d * DAY + mm(wh.start), end: d * DAY + mm(wh.end) }] : [];
        const free = subtractIntervals(win, busy).map((f) => ({ start: Math.max(f.start, nowAbs), end: f.end })).filter((f) => f.end > f.start);
        const within = (b) => b.start.slice(0, 10) === key;
        days.push({
          date: key, working, freeMinutes: free.reduce((s, f) => s + f.end - f.start, 0),
          plannedMinutes: approvedBlocks.filter((b) => within(b) && b.kind === 'task' && b.status !== 'skipped').reduce((s, b) => s + b.durationMinutes, 0),
          actualMinutes: actual.filter((a) => a.start.slice(0, 10) === key).reduce((s, a) => s + a.minutes, 0),
          appointmentCount: ctx.appointments.filter((a) => a.startAt.slice(0, 10) === key).length, deadlineCount: deadlines.filter((x) => x.dueDate === key && ['Pending', 'In Progress'].includes(x.status)).length,
          completedCount: completions.filter((c) => c.completedOn === key).length,
        });
      }
      return { range: { from, to }, today: ctx.today, now: ctx.nowLocal, timeZone: ctx.prefs.timeZone, workingHours: wh, days, appointments: ctx.appointments, unavailable: ctx.unavailable, approvedBlocks, draftBlocks, deadlines, completions, actualSessions: actual,
        hasDraft: versions.some((v) => v.status === 'draft'), hasApproved: versions.some((v) => v.status === 'approved'), draftId: versions.find((v) => v.status === 'draft')?.id ?? null, approvedId: versions.find((v) => v.status === 'approved')?.id ?? null };
    },
  };
}
module.exports = { createCalendarService };
