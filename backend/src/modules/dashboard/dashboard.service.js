'use strict';
const { dayKeyInZone, parseDateOnly, addDays, formatLocalDateTime } = require('../../utils/dates');
const { toPublicTask } = require('../tasks/tasks.mapper');
const { toItem } = require('../recommendations/runs.mapper');
const calc = require('../insights/insights.calc');
const { toPublicTimer } = require('../timer/timer.service');

const ACTIVE = ['Pending', 'In Progress'];

function createDashboardService({ prisma, now = () => new Date(), plannerSummary = null }) {
  return {
    async summary(userId) {
      const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
      const timeZone = prefs?.timeZone ?? 'Asia/Kolkata';
      const today = dayKeyInZone(now(), timeZone);
      const todayDate = parseDateOnly(today);
      const tomorrowDate = parseDateOnly(addDays(today, 1));
      const weekDays = calc.dayRange(today, 7);
      const live = { userId, deletedAt: null };

      const [byStatus, recent, upcoming, overdue, completedRows, weekSessions, runsWeek, latestRun, todaySession, activeTimer, finishedTimers] = await Promise.all([
        prisma.task.groupBy({ by: ['status'], where: live, _count: { _all: true } }),
        prisma.task.findMany({ where: live, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 5 }),
        prisma.task.findMany({ where: { ...live, status: { in: ACTIVE }, dueDate: { gte: todayDate } }, orderBy: [{ dueDate: 'asc' }, { importanceRank: 'asc' }, { id: 'asc' }], take: 5 }),
        prisma.task.count({ where: { ...live, status: { in: ACTIVE }, dueDate: { lt: todayDate } } }),
        prisma.task.findMany({ where: { ...live, completedAt: { gte: new Date(now().getTime() - 9 * 86400000) } }, select: { completedAt: true } }),
        prisma.focusSession.findMany({ where: { userId, sessionDateTime: { gte: parseDateOnly(weekDays[0]), lt: tomorrowDate } }, select: { sessionDateTime: true, availableTimeMinutes: true } }),
        prisma.recommendationRun.count({ where: { userId, createdAt: { gte: new Date(now().getTime() - 7 * 86400000) } } }),
        prisma.recommendationRun.findFirst({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: { id: true, createdAt: true } }),
        prisma.focusSession.findFirst({ where: { userId, sessionDateTime: { gte: todayDate, lt: tomorrowDate } }, orderBy: { sessionDateTime: 'desc' } }),
        prisma.focusTimer.findFirst({ where: { userId, status: { in: ['running', 'paused'] } }, include: { pauses: true } }),
        prisma.focusTimer.findMany({ where: { userId, status: 'finished', endedAt: { gte: new Date(now().getTime() - 9 * 86400000) } }, select: { endedAt: true, actualFocusedSeconds: true } }),
      ]);

      const n = (s) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
      const total = byStatus.reduce((a, r) => a + r._count._all, 0);

      // Highest-ranked item of the latest run whose task still exists and is still open.
      let todaysRecommendation = null;
      if (latestRun) {
        const item = await prisma.recommendationItem.findFirst({
          where: { recommendationRunId: latestRun.id, task: { is: { status: { in: ACTIVE }, deletedAt: null } } },
          orderBy: { rank: 'asc' },
        });
        if (item) todaysRecommendation = { runId: latestRun.id, generatedAt: latestRun.createdAt.toISOString(), item: toItem(item) };
      }

      const todaysFocus = todaySession
        ? { source: 'session', sessionId: todaySession.id, sessionDateTime: formatLocalDateTime(todaySession.sessionDateTime), availableTimeMinutes: todaySession.availableTimeMinutes, energyLevel: todaySession.energyLevel, focusLevel: todaySession.focusLevel, currentTimePeriod: todaySession.currentTimePeriod }
        : { source: 'preferences', sessionId: null, sessionDateTime: null, availableTimeMinutes: null, energyLevel: prefs?.defaultEnergyLevel ?? 'Medium', focusLevel: prefs?.defaultFocusLevel ?? 'Medium', currentTimePeriod: prefs?.preferredTimePeriod ?? 'Morning' };

      const timerDays = calc.timerTrend({ days: weekDays, timers: finishedTimers, timeZone });
      const doneByDay = calc.countByDay(completedRows.map((r) => r.completedAt), weekDays, timeZone);
      const planner = plannerSummary ? await plannerSummary(userId).catch(() => null) : null;
      return {
        today, timeZone, planner,
        stats: { totalTasks: total, pendingTasks: n('Pending') + n('In Progress'), completedTasks: n('Completed'), completionPercentage: calc.rate(n('Completed'), total) },
        todaysRecommendation, todaysFocus, activeTimer: activeTimer ? toPublicTimer(activeTimer, now()) : null,
        recentTasks: recent.map(toPublicTask),
        upcomingDeadlines: upcoming.map(toPublicTask),
        overdueCount: overdue,
        productivity: {
          completedToday: doneByDay.get(today), completedLast7Days: [...doneByDay.values()].reduce((a, b) => a + b, 0),
          focusedMinutesToday: timerDays[timerDays.length - 1].focusedMinutes, focusedMinutesLast7Days: Math.round(timerDays.reduce((a, d) => a + d.focusedMinutes, 0) * 10) / 10,
          finishedTimersLast7Days: timerDays.reduce((a, d) => a + d.timers, 0),
          focusSessionsLast7Days: weekSessions.length, plannedMinutesLast7Days: weekSessions.reduce((a, s) => a + s.availableTimeMinutes, 0), recommendationRunsLast7Days: runsWeek,
        },
      };
    },
  };
}
module.exports = { createDashboardService };
