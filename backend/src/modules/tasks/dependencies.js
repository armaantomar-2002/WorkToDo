'use strict';
// Real task-to-task dependencies. An edge (taskId -> dependsOnTaskId) means "taskId cannot start until dependsOnTaskId is done".
// The Python contract only knows three values ("No dependency" | "Ready" | "Blocked"), so Node DERIVES that value from the edges:
//   - no edges to live tasks            -> "No dependency"
//   - any live prerequisite is open     -> "Blocked"   (open = Pending or In Progress)
//   - all prerequisites Completed or Cancelled (or deleted)  -> "Ready"
// The derived value is also stored in Task.dependencyStatus (kept in sync inside the same transaction) so lists can filter on it.
const { AppError } = require('../../errors/AppError');

const OPEN = ['Pending', 'In Progress'];
const MAX_PREREQUISITES = 20;

/** @param {Array<{status:string, deletedAt?:Date|null}>} prerequisites */
function deriveStatus(prerequisites) {
  const live = prerequisites.filter((p) => !p.deletedAt);
  if (live.length === 0) return 'No dependency';
  return live.some((p) => OPEN.includes(p.status)) ? 'Blocked' : 'Ready';
}

/** Would adding "taskId depends on dependsOnId" close a loop? `prereqs` : Map<taskId, string[]> of existing edges. */
function wouldCreateCycle(prereqs, taskId, dependsOnId) {
  if (taskId === dependsOnId) return true;
  const seen = new Set();
  const stack = [dependsOnId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === taskId) return true; // taskId is (transitively) a prerequisite of dependsOnId
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of prereqs.get(cur) ?? []) stack.push(next);
  }
  return false;
}

const lockUser = async (tx, userId) => { if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`; };

/** Recomputes and stores the derived status for the given tasks (owned by userId). */
async function recomputeStatusesTx(tx, userId, taskIds) {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return new Map();
  const map = await derivedStatusesFor(tx, userId, ids);
  for (const [id, status] of map) await tx.task.updateMany({ where: { id, userId, deletedAt: null }, data: { dependencyStatus: status } });
  return map;
}

/** Map<taskId, derived status> for `taskIds`, computed from live edges (does not write). */
async function derivedStatusesFor(db, userId, taskIds) {
  const edges = await db.taskDependency.findMany({ where: { userId, taskId: { in: taskIds } } });
  const prereqIds = [...new Set(edges.map((e) => e.dependsOnTaskId))];
  const prereqs = prereqIds.length ? await db.task.findMany({ where: { userId, id: { in: prereqIds } } }) : [];
  const byId = new Map(prereqs.map((t) => [t.id, t]));
  const out = new Map();
  for (const id of taskIds) {
    const list = edges.filter((e) => e.taskId === id).map((e) => byId.get(e.dependsOnTaskId)).filter(Boolean);
    out.set(id, deriveStatus(list));
  }
  return out;
}

/** Status change + completedAt bookkeeping + dependents' derived status, in the caller's transaction. */
async function setTaskStatusTx(tx, userId, taskId, status, at) {
  const existing = await tx.task.findFirst({ where: { id: taskId, userId, deletedAt: null } });
  if (!existing) throw new AppError({ status: 404, code: 'not_found', message: 'Task not found' });
  const completedAt = status === 'Completed' ? (existing.status === 'Completed' ? undefined : at) : null;
  await tx.task.updateMany({ where: { id: taskId, userId, deletedAt: null }, data: { status, completedAt } });
  await recomputeDependentsTx(tx, userId, taskId);
}
async function recomputeDependentsTx(tx, userId, taskId) {
  const dependents = await tx.taskDependency.findMany({ where: { userId, dependsOnTaskId: taskId } });
  await recomputeStatusesTx(tx, userId, dependents.map((d) => d.taskId));
}

const notFound = () => new AppError({ status: 404, code: 'not_found', message: 'Task not found' });
const unprocessable = (code, message, field) => new AppError({ status: 422, code, message, errors: field ? [{ field, message }] : undefined });

function createDependenciesService({ prisma }) {
  const toItem = (t) => ({ id: t.id, taskName: t.taskName, status: t.status, dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, isBlocking: OPEN.includes(t.status) });
  async function owned(db, userId, id) {
    const t = await db.task.findFirst({ where: { id, userId, deletedAt: null } });
    if (!t) throw notFound();
    return t;
  }
  async function view(db, userId, taskId) {
    const task = await owned(db, userId, taskId);
    const out = await db.taskDependency.findMany({ where: { userId, taskId } });
    const inn = await db.taskDependency.findMany({ where: { userId, dependsOnTaskId: taskId } });
    const ids = [...out.map((e) => e.dependsOnTaskId), ...inn.map((e) => e.taskId)];
    const tasks = ids.length ? await db.task.findMany({ where: { userId, deletedAt: null, id: { in: ids } } }) : [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return {
      taskId, dependencyStatus: task.dependencyStatus,
      prerequisites: out.map((e) => byId.get(e.dependsOnTaskId)).filter(Boolean).map(toItem),
      dependents: inn.map((e) => byId.get(e.taskId)).filter(Boolean).map((t) => ({ id: t.id, taskName: t.taskName, status: t.status })),
    };
  }
  return {
    list: (userId, taskId) => view(prisma, userId, taskId),

    async add(userId, taskId, dependsOnTaskId) {
      if (taskId === dependsOnTaskId) throw unprocessable('self_dependency', 'A task cannot depend on itself', 'dependsOnTaskId');
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId); // serialises concurrent edge changes for one user so two requests cannot jointly create a cycle
        await owned(tx, userId, taskId);
        const prereq = await tx.task.findFirst({ where: { id: dependsOnTaskId, userId, deletedAt: null } });
        if (!prereq) throw unprocessable('invalid_prerequisite', 'Prerequisite task not found', 'dependsOnTaskId'); // also covers other users' tasks
        const all = await tx.taskDependency.findMany({ where: { userId } });
        if (all.some((e) => e.taskId === taskId && e.dependsOnTaskId === dependsOnTaskId)) throw new AppError({ status: 409, code: 'dependency_exists', message: 'This dependency already exists' });
        if (all.filter((e) => e.taskId === taskId).length >= MAX_PREREQUISITES) throw unprocessable('too_many_dependencies', `A task can have at most ${MAX_PREREQUISITES} prerequisites`, 'dependsOnTaskId');
        const graph = new Map();
        for (const e of all) graph.set(e.taskId, [...(graph.get(e.taskId) ?? []), e.dependsOnTaskId]);
        if (wouldCreateCycle(graph, taskId, dependsOnTaskId)) throw unprocessable('circular_dependency', 'This would create a circular dependency', 'dependsOnTaskId');
        await tx.taskDependency.create({ data: { userId, taskId, dependsOnTaskId } });
        await recomputeStatusesTx(tx, userId, [taskId]);
        return view(tx, userId, taskId);
      });
    },

    async remove(userId, taskId, dependsOnTaskId) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        await owned(tx, userId, taskId);
        const res = await tx.taskDependency.deleteMany({ where: { userId, taskId, dependsOnTaskId } });
        if (res.count !== 1) throw new AppError({ status: 404, code: 'not_found', message: 'Dependency not found' });
        await recomputeStatusesTx(tx, userId, [taskId]);
        return view(tx, userId, taskId);
      });
    },
  };
}

module.exports = { deriveStatus, wouldCreateCycle, recomputeStatusesTx, recomputeDependentsTx, derivedStatusesFor, setTaskStatusTx, createDependenciesService, OPEN, MAX_PREREQUISITES };
