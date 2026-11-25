'use strict';
const { AppError } = require('../../errors/AppError');
const { parseDateOnly, formatDateOnly } = require('../../utils/dates');
const { IMPORTANCE_RANK } = require('../../constants/domain');
const { toPublicTask } = require('./tasks.mapper');
const { updateInput } = require('./tasks.validator');
const deps = require('./dependencies');

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

function createTasksService({ prisma, now = () => new Date() }) {
  const find = async (userId, id) => {
    const t = await prisma.task.findFirst({ where: { id, userId, deletedAt: null } }); // ownership is part of the query
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
        prisma.task.findMany({ where, orderBy: orderBy(filters), skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      ]);
      return { items: rows.map(toPublicTask), page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.max(1, Math.ceil(total / filters.pageSize)) };
    },
    async get(userId, id) { return toPublicTask(await find(userId, id)); },

    async create(userId, input) {
      const data = toDbDates({ ...input, importanceRank: IMPORTANCE_RANK[input.importance] });
      const created = await prisma.task.create({ data: { ...data, userId, completedAt: input.status === 'Completed' ? now() : null } });
      return toPublicTask(created);
    },

    async update(userId, id, body) {
      const existing = await find(userId, id);
      const asApi = toPublicTask(existing);
      const { patch } = updateInput(body, asApi);
      const data = toDbDates({ ...patch });
      if (patch.importance) data.importanceRank = IMPORTANCE_RANK[patch.importance];
      if (patch.status) Object.assign(data, statusFields(patch.status, existing.status));
      await prisma.$transaction(async (tx) => {
        const res = await tx.task.updateMany({ where: { id, userId, deletedAt: null }, data });
        if (res.count !== 1) throw notFound();
        if (patch.status) await deps.recomputeDependentsTx(tx, userId, id); // completing/reopening a prerequisite changes who is blocked
      });
      return toPublicTask(await find(userId, id));
    },

    async setStatus(userId, id, { status }) {
      await prisma.$transaction((tx) => deps.setTaskStatusTx(tx, userId, id, status, now()));
      return toPublicTask(await find(userId, id));
    },

    /** Soft delete: recommendation history keeps its snapshots, the task disappears from every list. */
    async remove(userId, id) {
      await prisma.$transaction(async (tx) => {
        const res = await tx.task.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: now() } });
        if (res.count !== 1) throw notFound();
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
