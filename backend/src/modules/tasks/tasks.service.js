'use strict';
const { AppError } = require('../../errors/AppError');
const { parseDateOnly, formatDateOnly } = require('../../utils/dates');
const { IMPORTANCE_RANK } = require('../../constants/domain');
const { toPublicTask } = require('./tasks.mapper');
const { updateInput } = require('./tasks.validator');
const deps = require('./dependencies');
const { toAbs, fromAbs } = require('../scheduler/time');

const INCLUDE = { appointment: true };
const lockUser = async (tx, userId) => { if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`; };
const endOf = (startAt, minutes) => fromAbs(toAbs(startAt) + minutes);

const notFound = () => new AppError({ status: 404, code: 'not_found', message: 'Task not found' });
const toDbDates = (o) => ({ ...o, ...('startDate' in o ? { startDate: o.startDate ? parseDateOnly(o.startDate) : null } : {}), ...('dueDate' in o ? { dueDate: o.dueDate ? parseDateOnly(o.dueDate) : null } : {}) });

function orderBy({ sortBy, sortOrder }) {
  const tail = [{ createdAt: 'desc' }, { id: 'asc' }]; // deterministic pagination
  if (sortBy === 'importance') return [{ importanceRank: sortOrder }, ...tail];
  if (sortBy === 'dueDate') return [{ dueDate: { sort: sortOrder, nulls: 'last' } }, ...tail];
  return [{ [sortBy]: sortOrder }, ...tail];
}

function buildWhere(userId, f) {
  const where = { userId, deletedAt: null };
  if (f.status) where.status = { in: f.status };
  if (f.importance) where.importance = { in: f.importance };
  if (f.dependencyStatus) where.dependencyStatus = f.dependencyStatus;
  if (f.dueFrom || f.dueTo) where.dueDate = { ...(f.dueFrom ? { gte: parseDateOnly(f.dueFrom) } : {}), ...(f.dueTo ? { lte: parseDateOnly(f.dueTo) } : {}) };
  if (f.search) where.OR = [{ taskName: { contains: f.search, mode: 'insensitive' } }, { description: { contains: f.search, mode: 'insensitive' } }];
  return where;
}

/** `appointments` = the existing appointments service (fixed-time tasks reuse its overlap rules, revisions and history). */
function createTasksService({ prisma, now = () => new Date(), appointments }) {
  const find = async (userId, id) => {
    const t = await prisma.task.findFirst({ where: { id, userId, deletedAt: null }, include: INCLUDE }); // ownership is part of the query
    if (!t) throw notFound();
    return t;
  };
  const statusFields = (status, previous) => ({
    status,
    completedAt: status === 'Completed' ? (previous === 'Completed' ? undefined : now()) : null,
  });

  return {
    async list(userId, filters) {
      const where = buildWhere(userId, filters);
      const [total, rows] = await Promise.all([
        prisma.task.count({ where }),
        prisma.task.findMany({ where, orderBy: orderBy(filters), skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize, include: INCLUDE }),
      ]);
      return { items: rows.map(toPublicTask), page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.max(1, Math.ceil(total / filters.pageSize)) };
    },
    async get(userId, id) { return toPublicTask(await find(userId, id)); },

    async create(userId, input) {
      const { fixedTime, ...fields } = input;
      const data = toDbDates({ ...fields, importanceRank: IMPORTANCE_RANK[fields.importance] });
      if (!fixedTime) {
        const created = await prisma.task.create({ data: { ...data, userId, completedAt: fields.status === 'Completed' ? now() : null }, include: INCLUDE });
        return toPublicTask(created);
      }
      // Fixed-time task: the appointment (created first, same overlap rules) holds the date/time; a conflict is a 409 and nothing is saved.
      if (!appointments) throw new AppError({ status: 500, code: 'internal_error', message: 'Fixed-time tasks are not available.' });
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const { appointment } = await appointments.createTx(tx, userId, { title: fields.taskName, description: fields.description ?? null, location: null, startAt: fixedTime.startAt, endAt: endOf(fixedTime.startAt, fixedTime.durationMinutes),
          preparationBufferMinutes: 0, travelBufferMinutes: 0, importance: fields.importance, consequenceOfDelay: fields.consequenceOfDelay });
        const created = await tx.task.create({ data: { ...data, userId, appointmentId: appointment.id, completedAt: fields.status === 'Completed' ? now() : null }, include: INCLUDE });
        return toPublicTask(created);
      });
    },

    async update(userId, id, body) {
      const existing = await find(userId, id);
      const asApi = toPublicTask(existing);
      const { patch, fixedTime } = updateInput(body, asApi);
      const data = toDbDates({ ...patch });
      if (patch.importance) data.importanceRank = IMPORTANCE_RANK[patch.importance];
      if (patch.status) Object.assign(data, statusFields(patch.status, existing.status));
      const linked = existing.appointment && existing.appointment.status === 'scheduled' ? existing.appointment : null;
      await prisma.$transaction(async (tx) => {
        if (linked || fixedTime) await lockUser(tx, userId);
        if (fixedTime === null && linked) { await appointments.cancelTx(tx, userId, linked.id, 'Task changed to flexible'); data.appointmentId = null; } // fixed -> flexible
        else if (fixedTime && linked) { // explicit user edit of the fixed time (the only way it can change)
          await appointments.moveTx(tx, userId, linked.id, { startAt: fixedTime.startAt, endAt: endOf(fixedTime.startAt, fixedTime.durationMinutes), ...(patch.taskName ? { title: patch.taskName } : {}) });
        } else if (fixedTime) { // flexible -> fixed
          const { appointment } = await appointments.createTx(tx, userId, { title: patch.taskName ?? existing.taskName, description: patch.description ?? existing.description ?? null, location: null, startAt: fixedTime.startAt, endAt: endOf(fixedTime.startAt, fixedTime.durationMinutes),
            preparationBufferMinutes: 0, travelBufferMinutes: 0, importance: patch.importance ?? existing.importance, consequenceOfDelay: patch.consequenceOfDelay ?? existing.consequenceOfDelay });
          data.appointmentId = appointment.id;
        } else if (linked && patch.taskName) await appointments.moveTx(tx, userId, linked.id, { title: patch.taskName });
        if (linked && patch.status === 'Cancelled') await appointments.cancelTx(tx, userId, linked.id, 'Task cancelled');
        const res = await tx.task.updateMany({ where: { id, userId, deletedAt: null }, data });
        if (res.count !== 1) throw notFound();
        if (patch.status) await deps.recomputeDependentsTx(tx, userId, id); // completing/reopening a prerequisite changes who is blocked
      });
      return toPublicTask(await find(userId, id));
    },

    async setStatus(userId, id, { status }) {
      await prisma.$transaction(async (tx) => {
        await deps.setTaskStatusTx(tx, userId, id, status, now());
        const t = status === 'Cancelled' ? await tx.task.findFirst({ where: { id, userId } }) : null;
        if (t && t.appointmentId && appointments) { await lockUser(tx, userId); await appointments.cancelTx(tx, userId, t.appointmentId, 'Task cancelled'); } // releases the time
      });
      return toPublicTask(await find(userId, id));
    },

    /** Soft delete: recommendation history keeps its snapshots, the task disappears from every list. */
    async remove(userId, id) {
      await prisma.$transaction(async (tx) => {
        const before = await tx.task.findFirst({ where: { id, userId, deletedAt: null } });
        const res = await tx.task.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: now() } });
        if (res.count !== 1) throw notFound();
        if (before && before.appointmentId && appointments) { await lockUser(tx, userId); await appointments.cancelTx(tx, userId, before.appointmentId, 'Task deleted'); }
        // A deleted task no longer blocks anything and is no longer blocked: drop its edges and refresh its dependents.
        const dependents = await tx.taskDependency.findMany({ where: { userId, dependsOnTaskId: id } });
        await tx.taskDependency.deleteMany({ where: { userId, taskId: id } });
        await tx.taskDependency.deleteMany({ where: { userId, dependsOnTaskId: id } });
        await deps.recomputeStatusesTx(tx, userId, dependents.map((d) => d.taskId));
      });
    },
  };
}
module.exports = { createTasksService, buildWhere, orderBy };
