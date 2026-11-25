'use strict';
// Minimal in-memory stand-in for the Prisma client, used ONLY by hermetic unit tests of service logic (ownership filters,
// token rotation, persistence payloads). It implements just the operations the services use. It is NOT a substitute for the
// real-database tests in test-db/ (which exercise Prisma + PostgreSQL + CHECK constraints) .
const crypto = require('node:crypto');

const RELATIONS = { authSession: { user: ['userId', 'user'] }, recommendationItem: { task: ['taskId', 'task'] } };

function cmp(value, cond, db) {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond;
  const t = (x) => (x instanceof Date ? x.getTime() : x);
  for (const [op, arg] of Object.entries(cond)) {
    if (op === 'in' && !arg.includes(value)) return false;
    if (op === 'notIn' && arg.includes(value)) return false;
    if (op === 'not' && value === arg) return false;
    if (op === 'gt' && !(t(value) > t(arg))) return false;
    if (op === 'gte' && !(t(value) >= t(arg))) return false;
    if (op === 'lt' && !(t(value) < t(arg))) return false;
    if (op === 'lte' && !(t(value) <= t(arg))) return false;
    if (op === 'contains' && !(typeof value === 'string' && value.toLowerCase().includes(String(arg).toLowerCase()))) return false;
  }
  return true;
}

function createMemoryPrisma() {
  const tables = {};
  const table = (name) => (tables[name] ??= []);
  let tick = Date.now();
  const now = () => new Date(++tick); // strictly increasing, so ordering by createdAt is deterministic
  const withDefaults = (model, data) => {
    const row = { id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), ...data };
    if (model === 'task') Object.assign(row, { dependencyStatus: 'No dependency', status: 'Pending', deletedAt: null, completedAt: null, minimumSessionMinutes: null, description: null, ...data, id: row.id });
    if (model === 'authSession') Object.assign(row, { revokedAt: null, replacedById: null, lastUsedAt: null, ...data });
    if (model === 'focusTimer') Object.assign(row, { endedAt: null, actualFocusedSeconds: null, totalPausedSeconds: null, taskId: null, taskNameSnapshot: null, focusSessionId: null, ...data });
    if (model === 'focusTimerPause') Object.assign(row, { resumedAt: null, ...data });
    if (model === 'recommendationFeedback') Object.assign(row, { comment: null, ...data });
    if (model === 'task') Object.assign(row, { postponedUntil: null, postponeCount: 0, ...data, id: row.id });
    if (model === 'appointment') Object.assign(row, { status: 'scheduled', cancelledAt: null, revision: 1, description: null, location: null, preparationBufferMinutes: 0, travelBufferMinutes: 0, importance: 'Medium', consequenceOfDelay: 'Moderate', ...data, id: row.id });
    if (model === 'appointmentHistory') Object.assign(row, { previousStartAt: null, previousEndAt: null, newStartAt: null, newEndAt: null, previousTitle: null, note: null, ...data, id: row.id });
    if (model === 'scheduleVersion') Object.assign(row, { revision: 1, approvedAt: null, rejectedAt: null, supersededAt: null, basedOnId: null, recommendationRunId: null, ...data, id: row.id });
    if (model === 'scheduledBlock') Object.assign(row, { taskId: null, taskNameSnapshot: null, sessionIndex: 1, sessionCount: 1, source: 'engine', status: 'planned', reason: null, warnings: null, ...data, id: row.id });
    if (model === 'taskPostponement') Object.assign(row, { originalDueDate: null, previousPostponedUntil: null, reason: null, ...data, id: row.id });
    if (model === 'user') Object.assign(row, { isActive: true, isEmailVerified: false, ...data });
    if (model === 'passwordResetToken') Object.assign(row, { usedAt: null, ...data });
    return row;
  };
  const matches = (model, row, where = {}) => Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return cond.some((w) => matches(model, row, w));
    if (k === 'AND') return cond.every((w) => matches(model, row, w));
    const rel = RELATIONS[model]?.[k];
    if (rel) {
      const target = table(k).find((r) => r.id === row[rel[0]]);
      const inner = cond && cond.is ? cond.is : cond;
      return target ? matches(k, target, inner) : false;
    }
    return cmp(row[k], cond);
  });
  const order = (rows, orderBy) => {
    const list = [].concat(orderBy || []);
    return [...rows].sort((a, b) => {
      for (const o of list) {
        const [k, spec] = Object.entries(o)[0];
        const dir = (typeof spec === 'object' ? spec.sort : spec) === 'desc' ? -1 : 1;
        const av = a[k] instanceof Date ? a[k].getTime() : a[k]; const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
        if (av === bv) continue;
        if (av == null) return 1; if (bv == null) return -1;
        return av < bv ? -dir : dir;
      }
      return 0;
    });
  };
  const nested = (model, row, data) => {
    const out = { ...data };
    if (model === 'user' && data.preferences) { delete out.preferences; table('userPreferences').push(withDefaults('userPreferences', { userId: row.id, ...data.preferences.create })); }
    if (model === 'recommendationRun') {
      delete out.items; delete out.exclusions;
      for (const i of data.items?.create ?? []) table('recommendationItem').push(withDefaults('recommendationItem', { ...i, recommendationRunId: row.id }));
      for (const e of data.exclusions?.create ?? []) table('recommendationExclusion').push(withDefaults('recommendationExclusion', { ...e, recommendationRunId: row.id }));
    }
    return out;
  };
  const include = (model, row, inc) => {
    if (!inc) return { ...row }; // copy, like Prisma: callers never hold a live reference to stored state
    const out = { ...row };
    if (inc.pauses) out.pauses = table('focusTimerPause').filter((p) => p.focusTimerId === row.id);
    if (inc.user) out.user = table('user').find((u) => u.id === row.userId);
    if (model === 'recommendationRun') {
      if (inc.items) out.items = order(table('recommendationItem').filter((i) => i.recommendationRunId === row.id && matches('recommendationItem', i, inc.items.where)), inc.items.orderBy).slice(0, inc.items.take ?? Infinity);
      if (inc.exclusions) out.exclusions = table('recommendationExclusion').filter((e) => e.recommendationRunId === row.id);
    }
    return out;
  };

  const modelApi = (model) => ({
    async create({ data, include: inc }) {
      const row = withDefaults(model, {});
      const clean = nested(model, Object.assign(row, data.id ? { id: data.id } : {}), data);
      for (const key of ['email', 'refreshTokenHash', 'tokenHash']) if (clean[key] !== undefined && table(model).some((r) => r[key] === clean[key])) { const e = new Error('Unique constraint failed'); e.code = 'P2002'; throw e; }
      // Emulates the migration's unique indexes (stand-in only; the real ones are exercised in test-db/ and on PostgreSQL).
      const dup = (pred) => table(model).some(pred) && Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      let violation = null;
      if (model === 'focusTimer' && ['running', 'paused'].includes(clean.status)) violation = dup((r) => r.userId === clean.userId && ['running', 'paused'].includes(r.status));
      if (model === 'focusTimerPause' && clean.resumedAt == null) violation = dup((r) => r.focusTimerId === clean.focusTimerId && r.resumedAt == null);
      if (model === 'taskDependency') violation = dup((r) => r.taskId === clean.taskId && r.dependsOnTaskId === clean.dependsOnTaskId);
      if (model === 'recommendationFeedback') violation = dup((r) => r.userId === clean.userId && r.recommendationItemId === clean.recommendationItemId);
      if (model === 'scheduleVersion') {
        if (['draft', 'approved'].includes(clean.status)) violation = dup((r) => r.userId === clean.userId && r.status === clean.status);
        violation = violation || dup((r) => r.userId === clean.userId && r.versionNumber === clean.versionNumber);
      }
      if (violation) throw violation;
      Object.assign(row, clean);
      table(model).push(row);
      return include(model, row, inc);
    },
    async findUnique({ where, include: inc }) { const r = table(model).find((x) => Object.entries(where).every(([k, v]) => x[k] === v)); return r ? include(model, r, inc) : null; },
    async findFirst({ where, orderBy, include: inc } = {}) { const r = order(table(model).filter((x) => matches(model, x, where)), orderBy)[0]; return r ? include(model, r, inc) : null; },
    async findMany({ where, orderBy, skip = 0, take, include: inc } = {}) { return order(table(model).filter((x) => matches(model, x, where)), orderBy).slice(skip, take === undefined ? undefined : skip + take).map((r) => include(model, r, inc)); },
    async count({ where } = {}) { return table(model).filter((x) => matches(model, x, where)).length; },
    async createMany({ data }) { for (const d of data) await this.create({ data: d }); return { count: data.length }; },
    async updateMany({ where, data }) { const rows = table(model).filter((x) => matches(model, x, where));
      if (model === 'scheduleVersion' && ['draft', 'approved'].includes(data.status)) for (const r of rows) if (table(model).some((o) => o !== r && o.userId === r.userId && o.status === data.status && !rows.includes(o))) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }); for (const r of rows) { for (const [k, v] of Object.entries(data)) if (v !== undefined) r[k] = v; r.updatedAt = now(); } return { count: rows.length }; },
    async update({ where, data }) { const r = table(model).find((x) => Object.entries(where).every(([k, v]) => x[k] === v)); if (!r) throw new Error('Record not found'); Object.assign(r, data, { updatedAt: now() }); return r; },
    async deleteMany({ where }) { const keep = table(model).filter((x) => !matches(model, x, where)); const n = table(model).length - keep.length; tables[model] = keep; return { count: n }; },
    async upsert({ where, update, create }) { const r = table(model).find((x) => Object.entries(where).every(([k, v]) => x[k] === v)); if (r) return Object.assign(r, update); const row = withDefaults(model, create); table(model).push(row); return row; },
  });

  const db = { _tables: tables };
  for (const m of ['user', 'userPreferences', 'authSession', 'passwordResetToken', 'task', 'focusSession', 'recommendationRun', 'recommendationItem', 'recommendationExclusion', 'taskDependency', 'focusTimer', 'focusTimerPause', 'recommendationFeedback', 'appointment', 'appointmentHistory', 'unavailablePeriod', 'scheduleVersion', 'scheduledBlock', 'taskPostponement']) db[m] = modelApi(m);
  // Transactions roll back on error (snapshot/restore), so atomicity of multi-record changes can be tested. Stand-in only: no isolation/locking.
  let chain = Promise.resolve();
  // Transactions are SERIALISED (like the per-user FOR UPDATE lock in production) so a rollback can never undo another transaction's commit. Stand-in only.
  const runTx = async (fn) => {
    // snapshot rows by identity so rollback restores values in place (test code may hold row references)
    const snap = Object.entries(tables).map(([name, rows]) => [name, rows.map((r) => [r, { ...r }])]);
    try { return await fn(db); } catch (e) {
      for (const k of Object.keys(tables)) delete tables[k];
      for (const [name, rows] of snap) { tables[name] = rows.map(([ref, copy]) => { for (const k of Object.keys(ref)) delete ref[k]; Object.assign(ref, copy); return ref; }); }
      throw e;
    }
  };
  db.$transaction = (fn) => { const run = chain.then(() => runTx(fn)); chain = run.catch(() => {}); return run; };
  return db;
}
module.exports = { createMemoryPrisma };
