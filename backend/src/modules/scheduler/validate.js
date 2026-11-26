'use strict';
/**
 * Independent schedule validator. Used (1) by the engine as a self-check, (2) by the API before a draft is edited (drag-and-drop)
 * or approved, so constraints are enforced on the BACKEND and never only in the browser.
 * Returns problems: { severity: 'error' | 'warning', code, message, taskId? }. An empty error list means the schedule is valid.
 */
const { DAY, dayNumberOf, weekdayOf, toAbs, dayOf, hhmm } = require('./time');

const ACTIVE = new Set(['Pending', 'In Progress']);
const bufferedSpan = (a) => { const s = toAbs(a.startAt); const e = toAbs(a.endAt); return { s: s - (a.preparationBufferMinutes ?? 0) - (a.travelBufferMinutes ?? 0), e: e + (a.travelBufferMinutes ?? 0), label: `appointment "${a.title ?? a.id}"` }; };

function validateSchedule(input, opts = {}) {
  const problems = []; const add = (severity, code, message, taskId) => problems.push({ severity, code, message, ...(taskId ? { taskId } : {}) });
  const now = toAbs(input.now);
  const wh = { start: hhmm(input.workingHours?.start ?? '09:00'), end: hhmm(input.workingHours?.end ?? '18:00'), days: new Set(input.workingHours?.days ?? [1, 2, 3, 4, 5]) };
  const tasks = new Map((input.tasks ?? []).map((t) => [t.id, t]));
  const work = (input.blocks ?? []).map((b) => ({ ...b, s: toAbs(b.start), e: toAbs(b.end), label: `task block ${b.taskId}` }));
  const brk = (input.breaks ?? []).map((b) => ({ ...b, s: toAbs(b.start), e: toAbs(b.end), label: 'break' }));
  const apptById = new Map((input.appointments ?? []).filter((a) => a.status !== 'cancelled').map((a) => [a.id, { s: toAbs(a.startAt), e: toAbs(a.endAt) }]));
  const fixed = [
    ...(input.appointments ?? []).filter((a) => a.status !== 'cancelled').map(bufferedSpan),
    ...(input.unavailable ?? []).map((u) => ({ s: toAbs(u.startAt), e: toAbs(u.endAt), label: `unavailable period "${u.label ?? ''}"` })),
    ...(input.lockedBlocks ?? []).map((b) => ({ s: toAbs(b.start), e: toAbs(b.end), label: `locked block ${b.taskId ?? ''}` })),
  ];

  // overlaps among everything (the same pair is reported once)
  const all = [...work, ...brk, ...fixed];
  for (const x of all) if (!(x.e > x.s)) add('error', 'invalid_interval', `${x.label} must end after it starts`, x.taskId);
  const sorted = all.map((x, i) => ({ ...x, i })).sort((a, b) => a.s - b.s || a.e - b.e);
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j].s < sorted[i].e; j++) {
    const a = sorted[i]; const b = sorted[j]; if (a.e > a.s && b.e > b.s) add('error', 'overlap', `${a.label} overlaps ${b.label}`, a.taskId ?? b.taskId);
  }

  for (const b of brk) {
    const d = dayOf(b.s);
    if (dayOf(b.e - 1) !== d || !wh.days.has(weekdayOf(d)) || b.s - d * DAY < wh.start || b.e - d * DAY > wh.end) add('error', 'break_outside_working_hours', 'a break is outside working hours');
    if (b.e - b.s > 240) add('error', 'break_too_long', 'a break cannot be longer than 4 hours');
  }
  const liveAppts = (input.appointments ?? []).filter((a) => a.status !== 'cancelled').map((a) => ({ s: toAbs(a.startAt), e: toAbs(a.endAt), t: a.title ?? a.id })).sort((a, b) => a.s - b.s);
  for (let i = 1; i < liveAppts.length; i++) if (liveAppts[i].s < Math.max(...liveAppts.slice(0, i).map((x) => x.e))) add('warning', 'appointments_overlap', `appointment "${liveAppts[i].t}" overlaps another appointment`);
  const perTask = new Map();
  for (const b of work) {
    const t = tasks.get(b.taskId);
    if (!t) { add('error', 'unknown_task', `block references an unknown task ${b.taskId}`, b.taskId); continue; }
    if (!perTask.has(b.taskId)) perTask.set(b.taskId, []); perTask.get(b.taskId).push(b);
    if (!ACTIVE.has(t.status)) add('error', 'task_not_active', `"${t.taskName}" is ${t.status} and must not be scheduled`, b.taskId);
    const d = dayOf(b.s);
    if (dayOf(b.e - 1) !== d || !wh.days.has(weekdayOf(d)) || b.s - d * DAY < wh.start || b.e - d * DAY > wh.end) add('error', 'outside_working_hours', `"${t.taskName}" is outside working hours`, b.taskId);
    if (!opts.allowPast && b.s < now) add('error', 'in_the_past', `"${t.taskName}" starts in the past`, b.taskId);
    const eff = [t.startDate, t.postponedUntil].filter(Boolean).sort().pop();
    if (eff && b.s < dayNumberOf(eff) * DAY) add('error', 'before_start_date', `"${t.taskName}" cannot start before ${eff}`, b.taskId);
    if (t.dueDate && b.e > (dayNumberOf(t.dueDate) + 1) * DAY && dayNumberOf(t.dueDate) >= dayOf(now)) add('warning', 'after_deadline', `"${t.taskName}" ends after its deadline ${t.dueDate}`, b.taskId);
  }
  for (const [id, mine] of perTask) {
    const t = tasks.get(id); const total = mine.reduce((s, b) => s + (b.e - b.s), 0);
    const remaining = t.estimatedDurationMinutes - (t.completedMinutes ?? 0) - lockedMinutes(input, id);
    if (total < remaining) add('warning', 'partially_scheduled', `"${t.taskName}" has ${total} of ${remaining} remaining minutes scheduled`, id);
    if (total > remaining) add('error', 'over_scheduled', `"${t.taskName}" has ${total} minutes scheduled but only ${remaining} remain`, id);
    if (!t.isSplittable && mine.length > 1) add('error', 'split_not_allowed', `"${t.taskName}" cannot be split into several sessions`, id);
    if (t.isSplittable) for (const b of mine) if (b.e - b.s < (t.minimumSessionMinutes ?? 1) && !(mine.length === 1 && total === remaining)) add('error', 'below_minimum_session', `a session of "${t.taskName}" is shorter than its ${t.minimumSessionMinutes}-minute minimum`, id);
    for (const pid of t.prerequisiteIds ?? []) {
      const p = tasks.get(pid); if (!p || !ACTIVE.has(p.status)) continue;
      if (p.appointmentId && apptById.has(p.appointmentId)) { if (mine.some((x) => x.s < apptById.get(p.appointmentId).e)) add('error', 'dependency_order', `"${t.taskName}" starts before its prerequisite "${p.taskName}" finishes`, id); continue; }
      const pb = (perTask.get(pid) ?? []).map((b) => b.e).concat((input.lockedBlocks ?? []).filter((l) => l.taskId === pid).map((l) => toAbs(l.end)));
      if (!pb.length) add('error', 'prerequisite_not_scheduled', `"${t.taskName}" depends on "${p.taskName}", which is not scheduled`, id);
      else if (mine.some((b) => b.s < Math.max(...pb))) add('error', 'dependency_order', `"${t.taskName}" starts before its prerequisite "${p.taskName}" finishes`, id);
    }
  }
  for (const t of tasks.values()) { // prerequisites of a fixed-time task must finish before the commitment starts
    const ap = t.appointmentId ? apptById.get(t.appointmentId) : null; if (!ap || !ACTIVE.has(t.status)) continue;
    for (const pid of t.prerequisiteIds ?? []) { const p = tasks.get(pid); if (!p || !ACTIVE.has(p.status)) continue;
      if ((perTask.get(pid) ?? []).some((b) => b.e > ap.s)) add('error', 'dependency_order', `"${p.taskName}" must finish before "${t.taskName}" starts (${input.appointments.find((x) => x.id === t.appointmentId)?.startAt ?? ''})`, pid); }
  }
  return opts.errorsOnly ? problems.filter((p) => p.severity === 'error') : problems.filter((p) => !(opts.skipLateChecks && p.code === 'after_deadline'));
}
const lockedMinutes = (input, id) => (input.lockedBlocks ?? []).filter((l) => l.taskId === id).reduce((s, l) => s + (toAbs(l.end) - toAbs(l.start)), 0);

const hasErrors = (problems) => problems.some((p) => p.severity === 'error');
module.exports = { validateSchedule, hasErrors };
