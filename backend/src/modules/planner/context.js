'use strict';
const crypto = require('node:crypto');
const { AppError } = require('../../errors/AppError');
const { parseWorkDays } = require('../users/user.mapper');
const { MAX_TASKS_PER_REQUEST } = require('../../validators/recommendationRequest');
const { toWall, fromWall, nowWall, safeZone, formatDateOnly, parseDateOnly, addDays } = require('./wall');

const ACTIVE = ['Pending', 'In Progress'];
const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');

function prefsOf(row) {
  const p = row ?? {};
  return {
    timeZone: safeZone(p.timeZone), energy: p.defaultEnergyLevel ?? 'Medium', focus: p.defaultFocusLevel ?? 'Medium',
    workingHours: { start: p.workDayStart ?? '09:00', end: p.workDayEnd ?? '18:00', days: parseWorkDays(p.workDays) },
    breaks: { enabled: p.breaksEnabled ?? true, minutes: p.breakMinutes ?? 10, afterContinuousMinutes: p.breakAfterMinutes ?? 90 },
    horizonDays: p.planningHorizonDays ?? 7,
  };
}

/**
 * Loads everything the scheduling engine needs, scoped to ONE user, in engine form. `window` = { from, to } date keys
 * (defaults to today .. today+horizon-1). Pure reads: safe to call on a transaction client.
 */
async function loadContext(db, userId, instant, window) {
  const prefs = prefsOf(await db.userPreferences.findUnique({ where: { userId } }));
  const nowLocal = nowWall(instant, prefs.timeZone);
  const today = nowLocal.slice(0, 10);
  const from = window?.from ?? today;
  const to = window?.to ?? addDays(today, prefs.horizonDays - 1);
  const lo = fromWall(`${addDays(from, -1)}T00:00`); const hi = fromWall(`${addDays(to, 2)}T00:00`);

  const rows = await db.task.findMany({ where: { userId, deletedAt: null, status: { in: ACTIVE } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (rows.length > MAX_TASKS_PER_REQUEST) throw new AppError({ status: 422, code: 'too_many_tasks', message: `You have ${rows.length} active tasks; at most ${MAX_TASKS_PER_REQUEST} can be planned at once. Complete or archive some first.` });
  const ids = rows.map((t) => t.id);
  const edges = ids.length ? await db.taskDependency.findMany({ where: { userId, taskId: { in: ids } } }) : [];
  const timers = ids.length ? await db.focusTimer.findMany({ where: { userId, status: 'finished', taskId: { in: ids } } }) : [];
  const secondsBy = new Map();
  for (const t of timers) secondsBy.set(t.taskId, (secondsBy.get(t.taskId) ?? 0) + (t.actualFocusedSeconds ?? 0));
  const prereq = new Map();
  for (const e of edges) { if (!prereq.has(e.taskId)) prereq.set(e.taskId, []); prereq.get(e.taskId).push(e.dependsOnTaskId); }

  const tasks = rows.map((t) => ({
    id: t.id, taskName: t.taskName, status: t.status, importance: t.importance, dueDate: formatDateOnly(t.dueDate), startDate: formatDateOnly(t.startDate),
    postponedUntil: formatDateOnly(t.postponedUntil), estimatedDurationMinutes: t.estimatedDurationMinutes, isSplittable: !!t.isSplittable,
    minimumSessionMinutes: t.isSplittable ? t.minimumSessionMinutes ?? 1 : null, preferredTime: t.preferredTime ?? 'Anytime',
    completedMinutes: Math.floor((secondsBy.get(t.id) ?? 0) / 60), prerequisiteIds: (prereq.get(t.id) ?? []).slice().sort(),
  }));

  const apptRows = await db.appointment.findMany({ where: { userId, status: 'scheduled', startAt: { lt: hi }, endAt: { gt: lo } }, orderBy: [{ startAt: 'asc' }, { id: 'asc' }] });
  const appointments = apptRows.map(apptToEngine);
  const unRows = await db.unavailablePeriod.findMany({ where: { userId, startAt: { lt: hi }, endAt: { gt: lo } }, orderBy: [{ startAt: 'asc' }, { id: 'asc' }] });
  const unavailable = unRows.map((u) => ({ id: u.id, label: u.label, startAt: toWall(u.startAt), endAt: toWall(u.endAt) }));

  const parts = {
    prefs: sha([prefs.workingHours, prefs.breaks, prefs.timeZone]), appointments: sha(apptRows.map((a) => [a.id, a.revision, toWall(a.startAt), toWall(a.endAt)])),
    unavailable: sha(unavailable.map((u) => [u.id, u.startAt, u.endAt])),
    tasks: sha(tasks.map((t) => [t.id, t.status, t.estimatedDurationMinutes, t.dueDate, t.startDate, t.postponedUntil, t.isSplittable, t.minimumSessionMinutes, t.preferredTime, t.importance, t.completedMinutes, t.prerequisiteIds])),
  };
  return { userId, prefs, nowLocal, today, window: { from, to }, tasks, appointments, unavailable, hashParts: parts, hash: sha(parts) };
}

const apptToEngine = (a) => ({ id: a.id, title: a.title, startAt: toWall(a.startAt), endAt: toWall(a.endAt), location: a.location ?? null, preparationBufferMinutes: a.preparationBufferMinutes, travelBufferMinutes: a.travelBufferMinutes, importance: a.importance, status: a.status });

/** Engine input for a context. `horizonDays` follows the window so old/approved versions are evaluated over their own horizon. */
function engineInput(ctx, extra = {}) {
  const span = Math.round((parseDateOnly(ctx.window.to) - parseDateOnly(ctx.window.from)) / 86400000) + 1;
  return {
    now: ctx.nowLocal, horizonDays: Math.max(1, Math.min(span, 60)), workingHours: ctx.prefs.workingHours, breaks: ctx.prefs.breaks,
    tasks: ctx.tasks, appointments: ctx.appointments, unavailable: ctx.unavailable, ...extra,
  };
}

module.exports = { loadContext, engineInput, prefsOf, apptToEngine, ACTIVE, sha };
