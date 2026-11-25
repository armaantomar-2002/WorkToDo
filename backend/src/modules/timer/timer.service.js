'use strict';
const { AppError } = require('../../errors/AppError');
const { toIso } = require('../../utils/dates');
const { computeElapsed, TRANSITIONS, ACTIVE_STATUSES } = require('./timer.calc');
const deps = require('../tasks/dependencies');

const notFound = () => new AppError({ status: 404, code: 'not_found', message: 'Focus timer not found' });
const conflict = (code, message, extra = {}) => new AppError({ status: 409, code, message, ...extra });
const DEFAULT_PLANNED_MINUTES = 25;

const lockUser = async (tx, userId) => { if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`; };

/** DB row (+ pauses) -> API shape. Elapsed values are computed on the server at `at`; clients only render them. */
function toPublicTimer(row, at) {
  const pauses = (row.pauses ?? []).slice().sort((a, b) => a.pausedAt - b.pausedAt);
  const ended = row.status === 'finished' || row.status === 'cancelled';
  const calc = computeElapsed(row, pauses, at);
  const focused = ended ? row.actualFocusedSeconds : calc.focusedSeconds;
  const paused = ended ? row.totalPausedSeconds : calc.pausedSeconds;
  const planned = row.plannedDurationMinutes * 60;
  return {
    id: row.id, status: row.status, taskId: row.taskId ?? null, taskName: row.taskNameSnapshot ?? null, focusSessionId: row.focusSessionId ?? null,
    plannedDurationMinutes: row.plannedDurationMinutes, plannedSeconds: planned,
    startedAt: toIso(row.startedAt), endedAt: toIso(row.endedAt),
    elapsedSeconds: focused, pausedSeconds: paused,
    remainingSeconds: Math.max(0, planned - focused), overtimeSeconds: Math.max(0, focused - planned), isOvertime: focused > planned,
    pauses: pauses.map((p) => ({ pausedAt: toIso(p.pausedAt), resumedAt: toIso(p.resumedAt) })),
    serverNow: toIso(at),
  };
}

function createTimerService({ prisma, now = () => new Date() }) {
  const load = async (db, userId, id) => {
    const row = await db.focusTimer.findFirst({ where: { id, userId }, include: { pauses: true } }); // ownership is part of the query
    if (!row) throw notFound();
    return row;
  };

  /** Runs one lifecycle transition atomically. The status guard in the UPDATE makes duplicate/racing requests fail with 409. */
  async function transition(userId, id, action, extra) {
    const spec = TRANSITIONS[action];
    const at = now();
    return prisma.$transaction(async (tx) => {
      const row = await load(tx, userId, id);
      if (!spec.from.includes(row.status)) throw conflict('invalid_transition', `Cannot ${action} a timer that is ${row.status}`, { logContext: { status: row.status } });
      const data = { status: spec.to };
      if (action === 'pause') {
        const guard = await tx.focusTimer.updateMany({ where: { id, userId, status: 'running' }, data });
        if (guard.count !== 1) throw conflict('invalid_transition', 'Timer is no longer running');
        await tx.focusTimerPause.create({ data: { focusTimerId: id, pausedAt: at } });
      } else if (action === 'resume') {
        const guard = await tx.focusTimer.updateMany({ where: { id, userId, status: 'paused' }, data });
        if (guard.count !== 1) throw conflict('invalid_transition', 'Timer is no longer paused');
        await tx.focusTimerPause.updateMany({ where: { focusTimerId: id, resumedAt: null }, data: { resumedAt: at } });
      } else {
        // finish / cancel: close any open pause at the end instant, then freeze the totals
        const pauses = row.pauses.map((p) => (p.resumedAt ? p : { ...p, resumedAt: at }));
        const calc = computeElapsed({ startedAt: row.startedAt, endedAt: at }, pauses, at);
        const guard = await tx.focusTimer.updateMany({
          where: { id, userId, status: { in: ACTIVE_STATUSES } },
          data: { ...data, endedAt: at, actualFocusedSeconds: calc.focusedSeconds, totalPausedSeconds: calc.pausedSeconds },
        });
        if (guard.count !== 1) throw conflict('invalid_transition', `Timer already ${row.status === 'running' || row.status === 'paused' ? 'changed' : row.status}`);
        await tx.focusTimerPause.updateMany({ where: { focusTimerId: id, resumedAt: null }, data: { resumedAt: at } });
        if (action === 'finish' && extra?.completeTask && row.taskId) {
          await deps.setTaskStatusTx(tx, userId, row.taskId, 'Completed', at);
        }
      }
      return toPublicTimer(await load(tx, userId, id), at);
    });
  }

  return {
    toPublicTimer,

    async start(userId, input) {
      const at = now();
      try {
        return await prisma.$transaction(async (tx) => {
          await lockUser(tx, userId);
          const existing = await tx.focusTimer.findFirst({ where: { userId, status: { in: ACTIVE_STATUSES } }, include: { pauses: true } });
          if (existing) throw conflict('timer_already_active', 'Finish or cancel your current focus timer before starting another', { logContext: { activeTimerId: existing.id } });
          let task = null;
          if (input.taskId) {
            task = await tx.task.findFirst({ where: { id: input.taskId, userId, deletedAt: null } });
            if (!task) throw new AppError({ status: 404, code: 'not_found', message: 'Task not found' });
            if (!['Pending', 'In Progress'].includes(task.status)) throw new AppError({ status: 422, code: 'task_not_active', message: 'Only Pending or In Progress tasks can be focused on' });
          }
          if (input.focusSessionId) {
            const s = await tx.focusSession.findFirst({ where: { id: input.focusSessionId, userId } });
            if (!s) throw new AppError({ status: 404, code: 'not_found', message: 'Focus session not found' });
          }
          const planned = input.plannedDurationMinutes ?? (task ? Math.min(720, task.estimatedDurationMinutes) : DEFAULT_PLANNED_MINUTES);
          const row = await tx.focusTimer.create({
            data: { userId, taskId: task?.id ?? null, taskNameSnapshot: task?.taskName ?? null, focusSessionId: input.focusSessionId, status: 'running', plannedDurationMinutes: planned, startedAt: at },
            include: { pauses: true },
          });
          if (task && task.status === 'Pending') await deps.setTaskStatusTx(tx, userId, task.id, 'In Progress', at);
          return toPublicTimer(row, at);
        });
      } catch (e) {
        if (e && e.code === 'P2002') throw conflict('timer_already_active', 'A focus timer is already running'); // lost the race to the partial unique index
        throw e;
      }
    },

    async active(userId) {
      const at = now();
      const row = await prisma.focusTimer.findFirst({ where: { userId, status: { in: ACTIVE_STATUSES } }, include: { pauses: true } });
      return row ? toPublicTimer(row, at) : null;
    },
    async get(userId, id) { const at = now(); return toPublicTimer(await load(prisma, userId, id), at); },
    pause: (userId, id) => transition(userId, id, 'pause'),
    resume: (userId, id) => transition(userId, id, 'resume'),
    finish: (userId, id, input) => transition(userId, id, 'finish', input),
    cancel: (userId, id) => transition(userId, id, 'cancel'),

    async history(userId, { page, pageSize, taskId }) {
      const at = now();
      const where = { userId, status: { in: ['finished', 'cancelled'] }, ...(taskId ? { taskId } : {}) };
      const [total, rows] = await Promise.all([
        prisma.focusTimer.count({ where }),
        prisma.focusTimer.findMany({ where, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, include: { pauses: true } }),
      ]);
      return { items: rows.map((r) => toPublicTimer(r, at)), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
    },
  };
}
module.exports = { createTimerService, toPublicTimer, DEFAULT_PLANNED_MINUTES };
