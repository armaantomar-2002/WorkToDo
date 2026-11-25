'use strict';
const { dayKeyInZone, parseDateOnly } = require('../../utils/dates');
const { validateQuery, validationError } = require('../../http/validate');
const D = require('../../constants/domain');
const calc = require('./insights.calc');

function rangeQuery(query) {
  const q = validateQuery(query, { range: { type: 'int' } });
  const range = q.range ?? 30;
  if (!calc.RANGES.includes(range)) throw validationError([{ field: 'range', message: `must be one of: ${calc.RANGES.join(', ')}` }]);
  return range;
}

function createInsightsService({ prisma, now = () => new Date() }) {
  async function context(userId, range) {
    const prefs = await prisma.userPreferences.findUnique({ where: { userId }, select: { timeZone: true } });
    const timeZone = prefs?.timeZone ?? 'Asia/Kolkata';
    const today = dayKeyInZone(now(), timeZone);
    const days = calc.dayRange(today, range);
    // Generous instant window; exact day membership is decided per time zone by the calc helpers.
    const since = new Date(now().getTime() - (range + 2) * 86400000);
    return { timeZone, today, days, since, sessionSince: parseDateOnly(days[0]) };
  }
  const base = (userId) => ({ userId, deletedAt: null });

  return {
    rangeQuery,

    async summary(userId, range) {
      const c = await context(userId, range);
      const [byStatus, sessionAgg, createdRows, completedRows, sessions, timerAgg, timers] = await Promise.all([
        prisma.task.groupBy({ by: ['status'], where: base(userId), _count: { _all: true } }),
        prisma.focusSession.aggregate({ where: { userId }, _avg: { availableTimeMinutes: true }, _count: { _all: true } }),
        prisma.task.findMany({ where: { ...base(userId), createdAt: { gte: c.since } }, select: { createdAt: true } }),
        prisma.task.findMany({ where: { ...base(userId), completedAt: { gte: c.since } }, select: { completedAt: true } }),
        prisma.focusSession.findMany({ where: { userId, sessionDateTime: { gte: c.sessionSince } }, select: { sessionDateTime: true, availableTimeMinutes: true } }),
        prisma.focusTimer.aggregate({ where: { userId, status: 'finished' }, _avg: { actualFocusedSeconds: true }, _sum: { actualFocusedSeconds: true }, _count: { _all: true } }),
        prisma.focusTimer.findMany({ where: { userId, status: 'finished', endedAt: { gte: c.since } }, select: { endedAt: true, actualFocusedSeconds: true } }),
      ]);
      const n = (s) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
      const total = byStatus.reduce((a, r) => a + r._count._all, 0);
      const trend = calc.completionTrend({ days: c.days, completedAt: completedRows.map((r) => r.completedAt), createdAt: createdRows.map((r) => r.createdAt), timeZone: c.timeZone });
      const sess = calc.sessionTrend({ days: c.days, sessions });
      const tt = calc.timerTrend({ days: c.days, timers, timeZone: c.timeZone });
      return {
        range, timeZone: c.timeZone,
        totals: {
          totalTasks: total, completedTasks: n('Completed'), pendingTasks: n('Pending') + n('In Progress'), cancelledTasks: n('Cancelled'),
          completionRate: calc.rate(n('Completed'), total),
          // Avg. focus time = ACTUAL focused time per finished timer (pauses excluded). Planned availability is reported separately.
          avgFocusMinutes: Math.round((timerAgg._avg.actualFocusedSeconds ?? 0) / 60), totalFocusedMinutes: Math.round((timerAgg._sum.actualFocusedSeconds ?? 0) / 60), finishedTimers: timerAgg._count._all,
          avgPlannedMinutes: Math.round(sessionAgg._avg.availableTimeMinutes ?? 0), totalSessions: sessionAgg._count._all,
        },
        inRange: {
          completed: trend.reduce((a, d) => a + d.completed, 0), created: trend.reduce((a, d) => a + d.created, 0),
          sessions: sess.reduce((a, d) => a + d.sessions, 0), plannedMinutes: sess.reduce((a, d) => a + d.plannedMinutes, 0),
          focusedMinutes: Math.round(tt.reduce((a, d) => a + d.focusedMinutes, 0) * 10) / 10, finishedTimers: tt.reduce((a, d) => a + d.timers, 0),
        },
      };
    },

    async tasks(userId, range) {
      const c = await context(userId, range);
      const [statuses, importances, createdRows, completedRows] = await Promise.all([
        prisma.task.findMany({ where: base(userId), select: { status: true } }),
        prisma.task.findMany({ where: base(userId), select: { importance: true } }),
        prisma.task.findMany({ where: { ...base(userId), createdAt: { gte: c.since } }, select: { createdAt: true } }),
        prisma.task.findMany({ where: { ...base(userId), completedAt: { gte: c.since } }, select: { completedAt: true } }),
      ]);
      return {
        range, timeZone: c.timeZone,
        byStatus: calc.distribution(D.TASK_STATUS, statuses.map((r) => r.status)),
        byImportance: calc.distribution(D.IMPORTANCE, importances.map((r) => r.importance)),
        completionTrend: calc.completionTrend({ days: c.days, completedAt: completedRows.map((r) => r.completedAt), createdAt: createdRows.map((r) => r.createdAt), timeZone: c.timeZone }),
      };
    },

    async sessions(userId, range) {
      const c = await context(userId, range);
      const timers = await prisma.focusTimer.findMany({ where: { userId, status: 'finished', endedAt: { gte: c.since } }, select: { endedAt: true, actualFocusedSeconds: true } });
      const rows = await prisma.focusSession.findMany({
        where: { userId, sessionDateTime: { gte: c.sessionSince } },
        select: { sessionDateTime: true, availableTimeMinutes: true, longestFreeSlotMinutes: true, energyLevel: true, focusLevel: true, currentTimePeriod: true },
      });
      const timerDays = calc.timerTrend({ days: c.days, timers, timeZone: c.timeZone });
      const inRange = rows.filter((r) => c.days.includes(r.sessionDateTime.toISOString().slice(0, 10)));
      return {
        range, timeZone: c.timeZone, totalSessions: inRange.length,
        avgAvailableMinutes: calc.average(inRange.map((r) => r.availableTimeMinutes)),
        avgLongestFreeSlotMinutes: calc.average(inRange.map((r) => r.longestFreeSlotMinutes)),
        trend: calc.sessionTrend({ days: c.days, sessions: rows }).map((d, i) => ({ ...d, focusedMinutes: timerDays[i].focusedMinutes, timers: timerDays[i].timers })),
        byEnergy: calc.distribution(D.LEVEL, inRange.map((r) => r.energyLevel)),
        byFocus: calc.distribution(D.LEVEL, inRange.map((r) => r.focusLevel)),
        byPeriod: calc.distribution(D.TIME_PERIOD, inRange.map((r) => r.currentTimePeriod)),
      };
    },
  };
}
module.exports = { createInsightsService, rangeQuery };
