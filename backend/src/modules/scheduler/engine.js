'use strict';
/**
 * Deterministic scheduling engine (pure: no I/O, no clock, no randomness; the caller injects `now`).
 * The ML ranking is only an ORDER hint. Hard constraints (appointments, availability, overlaps, start dates, deadlines, dependencies,
 * splitting rules) are enforced here and can never be overridden by a score. Same input => byte-identical output.
 *
 * All times are the user's LOCAL wall clock as "YYYY-MM-DDTHH:mm" strings; internally integer minutes (see time.js).
 */
const { DAY, dayNumberOf, dateKeyOf, weekdayOf, toAbs, fromAbs, dayOf, hhmm, ceilTo, mergeIntervals, subtractIntervals } = require('./time');

const ACTIVE = new Set(['Pending', 'In Progress']);
const PERIODS = { Morning: [300, 720], Afternoon: [720, 1020], Evening: [1020, 1260], Night: [1260, 1440] };
const IMPORTANCE_RANK = { Critical: 1, High: 2, Medium: 3, Low: 4 };

const DEFAULTS = Object.freeze({
  horizonDays: 7, granularityMinutes: 5,
  workingHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  breaks: { enabled: true, minutes: 10, afterContinuousMinutes: 90 },
});

/** Time an appointment makes unusable: preparation + travel before it, travel after it. */
function appointmentSpan(a) {
  const s = toAbs(a.startAt); const e = toAbs(a.endAt);
  if (!(e > s)) throw new RangeError(`appointment "${a.id ?? a.title}" must end after it starts`);
  return { id: a.id, title: a.title, start: s - (a.preparationBufferMinutes ?? 0) - (a.travelBufferMinutes ?? 0), end: e + (a.travelBufferMinutes ?? 0), coreStart: s, coreEnd: e };
}

function normaliseConfig(input) {
  const wh = { ...DEFAULTS.workingHours, ...(input.workingHours ?? {}) };
  const cfg = {
    now: toAbs(input.now),
    horizonDays: Math.min(Math.max(Math.trunc(input.horizonDays ?? DEFAULTS.horizonDays), 1), 60),
    gran: Math.min(Math.max(Math.trunc(input.granularityMinutes ?? DEFAULTS.granularityMinutes), 1), 60),
    wh: { start: hhmm(wh.start), end: hhmm(wh.end), days: new Set(wh.days) },
    breaks: { ...DEFAULTS.breaks, ...(input.breaks ?? {}) },
  };
  if (cfg.wh.end <= cfg.wh.start) throw new RangeError('working hours must end after they start');
  cfg.today = dayOf(cfg.now);
  cfg.lastDay = cfg.today + cfg.horizonDays - 1;
  return cfg;
}

/** Working-hour windows per day in [fromDay, toDay]. Days with a user "day off" are simply absent. */
function workingWindows(cfg, fromDay, toDay) {
  const out = [];
  for (let d = Math.max(fromDay, cfg.today); d <= Math.min(toDay, cfg.lastDay); d++) {
    if (cfg.wh.days.has(weekdayOf(d))) out.push({ start: d * DAY + cfg.wh.start, end: d * DAY + cfg.wh.end });
  }
  return out;
}

/** Fallback order when the ML ranking is unavailable: due date, then importance, then name/id. Deterministic. */
function fallbackCompare(a, b) {
  const da = a.dueDate ?? '9999-12-31'; const db = b.dueDate ?? '9999-12-31';
  return da < db ? -1 : da > db ? 1 : (IMPORTANCE_RANK[a.importance] ?? 9) - (IMPORTANCE_RANK[b.importance] ?? 9) || String(a.taskName ?? '').localeCompare(String(b.taskName ?? '')) || (a.id < b.id ? -1 : 1);
}

function generateSchedule(input) {
  const cfg = normaliseConfig(input);
  const taskList = input.tasks ?? [];
  const byId = new Map(taskList.map((t) => [t.id, t]));
  const explain = [];

  // ---- fixed time: appointments (cancelled ones release their time), manual unavailable periods, locked work ----
  const appts = (input.appointments ?? []).filter((a) => a.status !== 'cancelled').map(appointmentSpan);
  const unavailable = (input.unavailable ?? []).map((u) => ({ start: toAbs(u.startAt), end: toAbs(u.endAt), label: u.label ?? 'Unavailable' }));
  const locked = (input.lockedBlocks ?? []).map((b) => ({ taskId: b.taskId, start: toAbs(b.start), end: toAbs(b.end), kind: b.kind ?? 'task' }));
  const fixedBusy = [...appts, ...unavailable, ...locked];
  const placed = []; // new work blocks, absolute minutes: { taskId, start, end }
  const breaks = []; // suggested breaks: { start, end }
  const busyNow = () => [...fixedBusy, ...placed, ...breaks];

  // ---- order: ML ranking when supplied, else fallback; stable and deterministic ----
  const rankOf = new Map((input.ranking ?? []).map((r) => [r.taskId, r.rank]));
  const orderSource = rankOf.size ? 'ml' : 'fallback';
  const lockedBy = new Map();
  for (const l of locked) if (l.taskId) lockedBy.set(l.taskId, (lockedBy.get(l.taskId) ?? 0) + (l.end - l.start));

  const skipped = []; const unscheduled = []; const eligible = [];
  for (const t of taskList) {
    if (!ACTIVE.has(t.status)) { skipped.push({ taskId: t.id, code: 'not_active', message: `${t.status} tasks are never scheduled` }); continue; }
    const remaining = t.estimatedDurationMinutes - (t.completedMinutes ?? 0) - (lockedBy.get(t.id) ?? 0);
    if (remaining <= 0) { skipped.push({ taskId: t.id, code: 'no_remaining_work', message: 'Nothing remains to schedule' }); continue; }
    eligible.push({ ...t, remaining, effectiveStart: [t.startDate, t.postponedUntil].filter(Boolean).sort().pop() ?? null });
  }
  eligible.sort((a, b) => {
    const ra = rankOf.has(a.id) ? rankOf.get(a.id) : Infinity; const rb = rankOf.has(b.id) ? rankOf.get(b.id) : Infinity;
    return ra !== rb ? ra - rb : fallbackCompare(a, b);
  });
  const eligibleIds = new Set(eligible.map((t) => t.id));

  const summary = new Map(); const done = new Set(); const failed = new Map(); const visiting = new Set();

  function contiguousRunBefore(t) { // minutes of flexible work touching `t` from the left
    let run = 0; let edge = t;
    const work = () => [...placed, ...locked.filter((l) => l.taskId)]; // kept/approved blocks count as continuous work too
    for (;;) { const b = work().find((x) => x.end === edge); if (!b) break; run += b.end - b.start; edge = b.start; }
    return run;
  }

  /** Free pieces for a task, in the order candidates are tried. */
  function candidateSlots(t, lo, hi) {
    const free = subtractIntervals(workingWindows(cfg, dayOf(lo), dayOf(hi - 1)), busyNow());
    const pref = PERIODS[t.preferredTime];
    const need = t.isSplittable ? Math.min(t.minimumSessionMinutes ?? 1, t.remaining) : t.remaining;
    const out = [];
    for (const f of free) {
      const s0 = Math.max(f.start, lo); const e0 = Math.min(f.end, hi);
      if (e0 - s0 < 1) continue;
      let start = s0; let preferred = false;
      if (pref) {
        const d = dayOf(s0) * DAY; const ps = Math.max(s0, d + pref[0]); const pe = Math.min(e0, d + pref[1]);
        if (pe - ps >= need) { start = ps; preferred = true; }
      }
      start = ceilTo(start, cfg.gran);
      if (e0 - start >= 1) out.push({ start, end: e0, day: dayOf(start), preferred });
    }
    return out.sort((a, b) => a.day - b.day || (a.preferred === b.preferred ? 0 : a.preferred ? -1 : 1) || a.start - b.start);
  }

  /** Where could the next chunk start in `slot`? Inserts a break first when continuous work would run too long. */
  function startFor(slot, chunk, trialBreaks) {
    let start = slot.start; let brk = null;
    const br = cfg.breaks;
    if (br.enabled) {
      const run = contiguousRunBefore(start);
      if (run > 0 && run + chunk > br.afterContinuousMinutes) { const end = ceilTo(start + br.minutes, cfg.gran); brk = { start, end }; start = end; }
    }
    return { start, brk };
  }

  function placeTask(t, earliest) {
    const lo = Math.max(cfg.now, earliest ?? 0, t.effectiveStart != null ? dayNumberOf(t.effectiveStart) * DAY : 0);
    const dueDay = t.dueDate ? dayNumberOf(t.dueDate) : null;
    const overdue = dueDay != null && dueDay < cfg.today;
    const hi = (overdue || dueDay == null ? cfg.lastDay : Math.min(dueDay, cfg.lastDay)) * DAY + DAY;
    const startDay = t.effectiveStart ? dayNumberOf(t.effectiveStart) : null;
    if (startDay != null && startDay > cfg.lastDay) return { ok: false, code: 'starts_after_horizon', message: `Starts on ${t.effectiveStart}, after the planning horizon (${dateKeyOf(cfg.lastDay)}).` };
    if (t.isSplittable && t.minimumSessionMinutes > t.remaining && t.remaining > 0 && t.minimumSessionMinutes > t.estimatedDurationMinutes) return { ok: false, code: 'min_session_exceeds_task', message: 'Minimum session is longer than the task.' };

    const trialPlaced = placed.length; const trialBreaks = breaks.length;
    const sessions = []; let left = t.remaining;
    const rollback = () => { placed.length = trialPlaced; breaks.length = trialBreaks; };
    const cap = Math.max(cfg.breaks.afterContinuousMinutes, t.minimumSessionMinutes ?? 0);

    let guard = 0;
    while (left > 0 && guard++ < 500) {
      const slots = candidateSlots(t, lo, hi); let progressed = false;
      for (const slot of slots) {
        const { start, brk } = startFor(slot, Math.min(left, t.isSplittable ? cap : left), breaks);
        const avail = slot.end - start;
        let chunk;
        if (!t.isSplittable) { if (avail < left) continue; chunk = left; }
        else {
          const min = t.minimumSessionMinutes ?? 1;
          if (avail < Math.min(min, left)) continue;
          chunk = Math.min(avail, left, cap); const rest = left - chunk;
          if (rest > 0 && rest < min) { if (avail >= left) chunk = left; else chunk -= (min - rest); }
          if (chunk < Math.min(min, left)) continue;
        }
        if (brk) breaks.push(brk);
        placed.push({ taskId: t.id, start, end: start + chunk });
        sessions.push({ start, end: start + chunk, preferred: slot.preferred });
        left -= chunk; progressed = true; break;
      }
      if (!progressed) break;
    }
    if (left > 0) {
      rollback();
      const free = subtractIntervals(workingWindows(cfg, dayOf(lo), dayOf(hi - 1)), busyNow()).map((f) => ({ start: Math.max(f.start, lo), end: Math.min(f.end, hi) })).filter((f) => f.end > f.start);
      const total = free.reduce((s, f) => s + (f.end - f.start), 0); const longest = free.reduce((m, f) => Math.max(m, f.end - f.start), 0);
      const until = overdue || dueDay == null ? `the end of the planning horizon (${dateKeyOf(cfg.lastDay)})` : `its deadline (${t.dueDate})`;
      if (!t.isSplittable && total >= t.remaining) return { ok: false, code: 'no_slot_long_enough', message: `Needs one uninterrupted ${t.remaining}-minute slot (it cannot be split) but the longest free slot before ${until} is ${longest} minutes (${total} minutes free in total).` };
      if (t.isSplittable && total >= t.remaining) return { ok: false, code: 'no_valid_sessions', message: `Free time exists (${total} min) but not in pieces of at least ${t.minimumSessionMinutes ?? 1} minutes.` };
      return { ok: false, code: dueDay != null && !overdue ? 'no_time_before_deadline' : 'insufficient_time', message: `Needs ${t.remaining} minutes but only ${total} minutes are free before ${until}.` };
    }
    return { ok: true, sessions, overdue };
  }

  function schedule(t, stack = []) {
    if (done.has(t.id) || failed.has(t.id)) return;
    if (visiting.has(t.id)) return; // cycle guard (the API forbids cycles; never loop)
    visiting.add(t.id);
    let earliest = 0; let blocker = null;
    for (const pid of t.prerequisiteIds ?? []) {
      const p = byId.get(pid);
      if (!p || !ACTIVE.has(p.status)) continue; // completed / cancelled / deleted prerequisite: satisfied
      if (eligibleIds.has(pid)) { schedule(eligible.find((x) => x.id === pid), [...stack, t.id]); }
      if (failed.has(pid)) { blocker = { id: pid, name: p.taskName, why: 'could not be scheduled' }; break; }
      const ends = placed.filter((b) => b.taskId === pid).map((b) => b.end).concat(locked.filter((b) => b.taskId === pid).map((b) => b.end));
      if (!ends.length) { blocker = { id: pid, name: p.taskName, why: 'has no scheduled time' }; break; }
      earliest = Math.max(earliest, ...ends);
    }
    visiting.delete(t.id);
    if (blocker) {
      failed.set(t.id, true);
      unscheduled.push({ taskId: t.id, code: 'blocked_by_dependency', message: `Waiting for "${blocker.name}", which ${blocker.why}.`, remainingMinutes: t.remaining });
      return;
    }
    const r = placeTask(t, earliest);
    if (!r.ok) { failed.set(t.id, true); unscheduled.push({ taskId: t.id, code: r.code, message: r.message, remainingMinutes: t.remaining }); return; }
    done.add(t.id); summary.set(t.id, r);
  }
  for (const t of eligible) schedule(t);

  // ---- assemble output ----
  const blocks = []; const warnings = [];
  for (const t of eligible) {
    const r = summary.get(t.id); if (!r) continue;
    const mine = placed.filter((b) => b.taskId === t.id).sort((a, b) => a.start - b.start);
    const rank = rankOf.has(t.id) ? rankOf.get(t.id) : null;
    mine.forEach((b, i) => {
      const w = r.overdue ? ['overdue'] : [];
      blocks.push({
        taskId: t.id, kind: 'task', start: fromAbs(b.start), end: fromAbs(b.end), durationMinutes: b.end - b.start, sessionIndex: i + 1, sessionCount: mine.length, warnings: w,
        reason: `${rank != null ? `Ranked #${rank} by the recommendation model` : 'Ordered by due date and importance (no ML ranking)'}; placed in the earliest free slot${t.preferredTime && t.preferredTime !== 'Anytime' ? ` (prefers ${t.preferredTime.toLowerCase()})` : ''}${t.dueDate ? `, due ${t.dueDate}` : ''}${r.overdue ? ' — already overdue, scheduled as soon as possible' : ''}${mine.length > 1 ? `; session ${i + 1} of ${mine.length}` : ''}.`,
      });
    });
  }
  blocks.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.taskId < b.taskId ? -1 : 1));

  const taskSummaries = eligible.map((t) => {
    const mine = placed.filter((b) => b.taskId === t.id); const sched = mine.reduce((s, b) => s + (b.end - b.start), 0);
    return { taskId: t.id, estimatedMinutes: t.estimatedDurationMinutes, completedMinutes: t.completedMinutes ?? 0, lockedScheduledMinutes: lockedBy.get(t.id) ?? 0, remainingMinutes: t.remaining, scheduledMinutes: sched, sessionMinutes: mine.sort((a, b) => a.start - b.start).map((b) => b.end - b.start) };
  });

  const free = subtractIntervals(workingWindows(cfg, cfg.today, cfg.lastDay), busyNow()).map((f) => ({ start: Math.max(f.start, cfg.now), end: f.end })).filter((f) => f.end > f.start);
  const result = {
    now: fromAbs(cfg.now), horizon: { from: dateKeyOf(cfg.today), to: dateKeyOf(cfg.lastDay) }, orderSource,
    blocks, breaks: breaks.map((b) => ({ kind: 'break', start: fromAbs(b.start), end: fromAbs(b.end), durationMinutes: b.end - b.start, status: 'suggested', reason: `A ${b.end - b.start}-minute break after ${cfg.breaks.afterContinuousMinutes} minutes of continuous work.` })).sort((a, b) => (a.start < b.start ? -1 : 1)),
    appointments: (input.appointments ?? []).filter((a) => a.status !== 'cancelled').map((a) => ({ ...a, kind: 'appointment', fixed: true })),
    freeSlots: free.map((f) => ({ start: fromAbs(f.start), end: fromAbs(f.end), durationMinutes: f.end - f.start })),
    unscheduled: unscheduled.sort((a, b) => (a.taskId < b.taskId ? -1 : 1)), skipped, tasks: taskSummaries, warnings, explanations: explain,
  };
  // Self-check: the engine never emits a schedule that its own validator rejects.
  const { validateSchedule } = require('./validate');
  const problems = validateSchedule({ ...input, blocks: result.blocks, breaks: result.breaks, now: input.now }, { errorsOnly: true });
  if (problems.length) { const e = new Error(`scheduler produced an invalid schedule: ${problems[0].message}`); e.code = 'scheduler_invariant'; e.problems = problems; throw e; }
  return result;
}

module.exports = { generateSchedule, DEFAULTS, ACTIVE, PERIODS, appointmentSpan, normaliseConfig, workingWindows };
