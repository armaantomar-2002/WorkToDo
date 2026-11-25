'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { generateSchedule } = require('../src/modules/scheduler/engine');
const { validateSchedule, hasErrors } = require('../src/modules/scheduler/validate');
const { toAbs } = require('../src/modules/scheduler/time');

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WH = { start: '09:00', end: '18:00', days: ALL_DAYS };
let n = 0;
const T = (name, minutes, extra = {}) => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, taskName: name, status: 'Pending', importance: 'Medium', estimatedDurationMinutes: minutes, isSplittable: false, ...extra });
const base = (over) => ({ now: '2026-11-25T08:00', horizonDays: 1, workingHours: WH, breaks: { enabled: false }, ...over });
const span = (b) => [toAbs(b.start), toAbs(b.end)];
const blocksOf = (r, id) => r.blocks.filter((b) => b.taskId === id);
const total = (r, id) => blocksOf(r, id).reduce((s, b) => s + b.durationMinutes, 0);
const hhmmOf = (iso) => iso.slice(11);
const noOverlap = (r) => { const all = [...r.blocks, ...r.breaks, ...r.appointments.map((a) => ({ start: a.startAt, end: a.endAt }))].map(span).sort((a, b) => a[0] - b[0]); for (let i = 1; i < all.length; i++) assert.ok(all[i][0] >= all[i - 1][1], 'overlap'); };

describe('fixed appointments and overlaps', () => {
  test('an 11:00-13:00 appointment is protected; nothing flexible overlaps it', () => {
    const tasks = [T('A', 120), T('B', 180, { isSplittable: true, minimumSessionMinutes: 30 }), T('C', 30)];
    const r = generateSchedule(base({ tasks, appointments: [{ id: 'ap', title: 'Doctor', startAt: '2026-11-25T11:00', endAt: '2026-11-25T13:00' }] }));
    for (const b of r.blocks) assert.ok(toAbs(b.end) <= toAbs('2026-11-25T11:00') || toAbs(b.start) >= toAbs('2026-11-25T13:00'), `${b.start}-${b.end} touches the appointment`);
    assert.equal(r.appointments[0].startAt, '2026-11-25T11:00'); assert.equal(r.appointments[0].fixed, true); noOverlap(r);
  });
  test('preparation and travel buffers are respected (30 prep + 15 travel before, 15 travel after)', () => {
    const t = T('A', 60);
    const r = generateSchedule(base({ tasks: [t], now: '2026-11-25T09:00', appointments: [{ id: 'ap', title: 'Interview', startAt: '2026-11-25T11:00', endAt: '2026-11-25T12:00', preparationBufferMinutes: 30, travelBufferMinutes: 15 }], unavailable: [{ startAt: '2026-11-25T09:00', endAt: '2026-11-25T10:00' }] }));
    const [b] = r.blocks; assert.ok(toAbs(b.end) <= toAbs('2026-11-25T10:15') || toAbs(b.start) >= toAbs('2026-11-25T12:15'));
  });
  test('two flexible tasks competing for the same slot never overlap', () => {
    const r = generateSchedule(base({ tasks: [T('A', 120), T('B', 120)], unavailable: [{ startAt: '2026-11-25T13:00', endAt: '2026-11-25T18:00' }] })); noOverlap(r);
    assert.equal(r.blocks.length, 2);
  });
  test('manual unavailable periods are respected; free slots exclude them', () => {
    const r = generateSchedule(base({ tasks: [T('A', 60)], unavailable: [{ startAt: '2026-11-25T09:00', endAt: '2026-11-25T12:00', label: 'Errand' }] }));
    assert.ok(toAbs(r.blocks[0].start) >= toAbs('2026-11-25T12:00')); assert.ok(r.freeSlots.every((f) => toAbs(f.start) >= toAbs('2026-11-25T12:00') || toAbs(f.end) <= toAbs('2026-11-25T09:00')));
  });
  test('flexible tasks stay inside working hours and never in the past', () => {
    const fits = generateSchedule(base({ now: '2026-11-25T16:30', tasks: [T('A', 60)], horizonDays: 2 })); assert.equal(fits.blocks[0].start, '2026-11-25T16:30'); // 16:30-17:30 fits today
    const r = generateSchedule(base({ now: '2026-11-25T17:15', tasks: [T('A', 60)], horizonDays: 2 })); // only 45 min left today
    assert.equal(r.blocks[0].start, '2026-11-26T09:00'); assert.ok(toAbs(r.blocks[0].start) >= toAbs('2026-11-25T17:15'));
  });
});

describe('splitting', () => {
  const gaps = (extra = {}) => base({ unavailable: [{ startAt: '2026-11-25T10:30', endAt: '2026-11-25T14:00' }, { startAt: '2026-11-25T15:30', endAt: '2026-11-25T18:00' }], ...extra });
  test('3h splittable task is split across 9:00-10:30 and 14:00-15:30 and totals exactly 180', () => {
    const t = T('Study', 180, { isSplittable: true, minimumSessionMinutes: 30 });
    const r = generateSchedule(gaps({ tasks: [t] }));
    assert.deepEqual(blocksOf(r, t.id).map((b) => [hhmmOf(b.start), hhmmOf(b.end)]), [['09:00', '10:30'], ['14:00', '15:30']]); assert.equal(total(r, t.id), 180); assert.equal(r.unscheduled.length, 0);
  });
  test('3h NON-splittable task needs one continuous slot; with only 90-minute gaps it stays unscheduled with a reason', () => {
    const t = T('Movie', 180); const r = generateSchedule(gaps({ tasks: [t] }));
    assert.equal(r.blocks.length, 0); assert.equal(r.unscheduled[0].code, 'no_slot_long_enough'); assert.match(r.unscheduled[0].message, /longest free slot/);
  });
  test('a 3h non-splittable task is placed when a continuous 3h slot exists', () => {
    const t = T('Movie', 180); const r = generateSchedule(base({ tasks: [t] }));
    assert.deepEqual(blocksOf(r, t.id).map((b) => [hhmmOf(b.start), hhmmOf(b.end)]), [['09:00', '12:00']]);
  });
  test('slots shorter than the minimum session are rejected', () => {
    const t = T('Deep', 120, { isSplittable: true, minimumSessionMinutes: 60 });
    const r = generateSchedule(base({ tasks: [t], unavailable: [{ startAt: '2026-11-25T09:45', endAt: '2026-11-25T10:30' }, { startAt: '2026-11-25T11:15', endAt: '2026-11-25T12:00' }, { startAt: '2026-11-25T12:45', endAt: '2026-11-25T18:00' }] })); // free: three 45-min pieces = 135 min >= 120, but none reaches the 60-min minimum
    assert.equal(r.blocks.length, 0); assert.equal(r.unscheduled[0].code, 'no_valid_sessions');
  });
  test('no rounding drift: the last piece is never left below the minimum session', () => {
    const t = T('Odd', 100, { isSplittable: true, minimumSessionMinutes: 40 });
    const r = generateSchedule(base({ tasks: [t], unavailable: [{ startAt: '2026-11-25T10:00', endAt: '2026-11-25T14:00' }, { startAt: '2026-11-25T14:50', endAt: '2026-11-25T18:00' }] })); // free 60 + 50
    const sizes = blocksOf(r, t.id).map((b) => b.durationMinutes); assert.equal(sizes.reduce((a, b) => a + b, 0), 100); assert.ok(sizes.every((s) => s >= 40), sizes.join());
  });
  test('summary shows estimated, completed, remaining and session durations', () => {
    const t = T('Proj', 180, { isSplittable: true, minimumSessionMinutes: 30, completedMinutes: 60 });
    const r = generateSchedule(base({ tasks: [t] })); const s = r.tasks[0];
    assert.equal(s.estimatedMinutes, 180); assert.equal(s.completedMinutes, 60); assert.equal(s.remainingMinutes, 120); assert.equal(s.scheduledMinutes, 120);
  });
});

describe('task rules', () => {
  test('a task with a future start date is not scheduled before it', () => {
    const t = T('Later', 60, { startDate: '2026-11-27' }); const r = generateSchedule(base({ tasks: [t], horizonDays: 5 }));
    assert.equal(r.blocks[0].start.slice(0, 10), '2026-11-27');
    const far = generateSchedule(base({ tasks: [T('Far', 60, { startDate: '2027-01-01' })], horizonDays: 5 })); assert.equal(far.unscheduled[0].code, 'starts_after_horizon');
  });
  test('postponed-until acts as an additional earliest date', () => {
    const r = generateSchedule(base({ tasks: [T('P', 60, { postponedUntil: '2026-11-26' })], horizonDays: 3 })); assert.equal(r.blocks[0].start.slice(0, 10), '2026-11-26');
  });
  test('completed / cancelled tasks and tasks with no remaining work are never scheduled', () => {
    const r = generateSchedule(base({ tasks: [T('Done', 60, { status: 'Completed' }), T('X', 60, { status: 'Cancelled' }), T('Finished', 60, { completedMinutes: 60 })] }));
    assert.equal(r.blocks.length, 0); assert.equal(r.skipped.length, 3); assert.equal(r.unscheduled.length, 0);
  });
  test('due-tomorrow beats due-next-week when ranking is unavailable', () => {
    const later = T('Later', 60, { dueDate: '2026-12-02' }); const soon = T('Soon', 60, { dueDate: '2026-11-26' });
    const r = generateSchedule(base({ tasks: [later, soon], horizonDays: 7 }));
    assert.ok(toAbs(blocksOf(r, soon.id)[0].start) < toAbs(blocksOf(r, later.id)[0].start));
  });
  test('tasks are scheduled before their deadline, or reported unscheduled when that is impossible (never silently late)', () => {
    const t = T('Tight', 600, { dueDate: '2026-11-25' }); const r = generateSchedule(base({ tasks: [t], horizonDays: 5 }));
    assert.equal(r.blocks.length, 0); assert.equal(r.unscheduled[0].code, 'no_time_before_deadline'); assert.match(r.unscheduled[0].message, /deadline \(2026-11-25\)/);
  });
  test('an already-overdue task is scheduled as soon as possible and flagged', () => {
    const r = generateSchedule(base({ tasks: [T('Late', 60, { dueDate: '2026-11-20' })] })); assert.deepEqual(r.blocks[0].warnings, ['overdue']);
  });
  test('insufficient time: unscheduled tasks are listed with reasons and nothing is forced in', () => {
    const tasks = [T('A', 240), T('B', 240), T('C', 240)]; const r = generateSchedule(base({ tasks }));
    assert.equal(r.blocks.length, 2); assert.equal(r.unscheduled.length, 1); assert.ok(r.unscheduled[0].message.length > 20); assert.equal(r.unscheduled[0].remainingMinutes, 240); noOverlap(r);
  });
  test('preferred period is honoured when a slot exists, but is not a hard rule', () => {
    const aft = T('Afternoon task', 60, { preferredTime: 'Afternoon' }); const r = generateSchedule(base({ tasks: [aft] })); assert.equal(hhmmOf(r.blocks[0].start), '12:00');
    const full = generateSchedule(base({ tasks: [aft], unavailable: [{ startAt: '2026-11-25T12:00', endAt: '2026-11-25T18:00' }] })); assert.equal(hhmmOf(full.blocks[0].start), '09:00');
  });
  test('non-working days are skipped', () => {
    const r = generateSchedule(base({ now: '2026-11-27T17:30', horizonDays: 4, workingHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] }, tasks: [T('Fri/Mon', 120)] })); // Fri 27 Nov; Sat/Sun off
    assert.equal(r.blocks[0].start, '2026-11-30T09:00');
  });
});

describe('dependencies', () => {
  test('a dependent is scheduled after its prerequisite even if it ranks higher', () => {
    const pre = T('Pre', 60); const dep = T('Dep', 60, { prerequisiteIds: [pre.id] });
    const r = generateSchedule(base({ tasks: [dep, pre], ranking: [{ taskId: dep.id, rank: 1 }, { taskId: pre.id, rank: 2 }] }));
    assert.ok(toAbs(blocksOf(r, dep.id)[0].start) >= toAbs(blocksOf(r, pre.id)[0].end)); assert.deepEqual(validateSchedule({ ...base({ tasks: [dep, pre] }), blocks: r.blocks, breaks: r.breaks }).filter((p) => p.severity === 'error'), []);
  });
  test('a dependent whose prerequisite cannot be scheduled stays unscheduled and says why', () => {
    const pre = T('Pre', 900); const dep = T('Dep', 30, { prerequisiteIds: [pre.id] }); const r = generateSchedule(base({ tasks: [pre, dep] }));
    assert.equal(r.blocks.length, 0); assert.equal(r.unscheduled.find((u) => u.taskId === dep.id).code, 'blocked_by_dependency');
  });
  test('completed prerequisites do not block', () => {
    const pre = T('Pre', 60, { status: 'Completed' }); const dep = T('Dep', 30, { prerequisiteIds: [pre.id] }); assert.equal(generateSchedule(base({ tasks: [pre, dep] })).blocks.length, 1);
  });
});

describe('rescheduling and approvals (engine side)', () => {
  const doctor = (over = {}) => ({ id: 'ap', title: 'Doctor', startAt: '2026-11-25T11:00', endAt: '2026-11-25T13:00', ...over });
  test('cancelling the appointment releases its time for tasks', () => {
    const t = T('Big', 360); const withAppt = generateSchedule(base({ tasks: [t], appointments: [doctor()] })); const without = generateSchedule(base({ tasks: [t], appointments: [doctor({ status: 'cancelled' })] }));
    assert.equal(withAppt.unscheduled.length, 1); assert.equal(without.unscheduled.length, 0); assert.deepEqual(without.appointments, []);
  });
  test('a rescheduled appointment protects the NEW time and frees the old one', () => {
    const t = T('Study', 120); const r = generateSchedule(base({ tasks: [t], appointments: [doctor({ startAt: '2026-11-25T15:00', endAt: '2026-11-25T17:00' })], unavailable: [{ startAt: '2026-11-25T09:00', endAt: '2026-11-25T11:00' }] }));
    assert.deepEqual(blocksOf(r, t.id).map((b) => [hhmmOf(b.start), hhmmOf(b.end)]), [['11:00', '13:00']]); noOverlap(r);
  });
  test('a task that overran: actual work is locked, only the remainder is rescheduled, other tasks move', () => {
    const a = T('Overran', 120, { isSplittable: true, minimumSessionMinutes: 30 }); const b = T('Other', 60);
    const locked = [{ taskId: a.id, start: '2026-11-25T09:00', end: '2026-11-25T10:30' }]; // actually worked 90 of 120
    const r = generateSchedule(base({ now: '2026-11-25T10:30', tasks: [a, b], lockedBlocks: locked }));
    assert.equal(total(r, a.id), 30); assert.equal(r.tasks.find((x) => x.taskId === a.id).lockedScheduledMinutes, 90); assert.ok(r.blocks.every((x) => toAbs(x.start) >= toAbs('2026-11-25T10:30'))); noOverlap(r);
  });
  test('without an ML ranking the engine still produces a complete valid schedule (transparent fallback)', () => {
    const r = generateSchedule(base({ tasks: [T('A', 60), T('B', 30)] })); assert.equal(r.orderSource, 'fallback'); assert.match(r.blocks[0].reason, /no ML ranking/);
    const ml = generateSchedule(base({ tasks: [T('A', 60)], ranking: [] })); assert.equal(ml.orderSource, 'fallback');
  });
  test('the ML ranking only changes the ORDER, never a hard constraint', () => {
    const a = T('A', 60); const b = T('B', 60);
    const r = generateSchedule(base({ tasks: [a, b], ranking: [{ taskId: b.id, rank: 1 }, { taskId: a.id, rank: 2 }], appointments: [{ id: 'x', title: 'X', startAt: '2026-11-25T09:00', endAt: '2026-11-25T10:00' }] }));
    assert.equal(blocksOf(r, b.id)[0].start, '2026-11-25T10:00'); assert.ok(blocksOf(r, a.id)[0].start > blocksOf(r, b.id)[0].start); assert.equal(r.orderSource, 'ml');
  });
});

describe('breaks', () => {
  test('a break is inserted after 90 minutes of continuous work, never over appointments or work', () => {
    const t = T('Long', 180, { isSplittable: true, minimumSessionMinutes: 30 });
    const r = generateSchedule(base({ tasks: [t], breaks: { enabled: true, minutes: 15, afterContinuousMinutes: 90 }, appointments: [{ id: 'x', title: 'X', startAt: '2026-11-25T14:00', endAt: '2026-11-25T15:00' }] }));
    assert.equal(total(r, t.id), 180); assert.equal(r.breaks.length, 1); assert.equal(r.breaks[0].durationMinutes, 15); noOverlap(r);
    assert.deepEqual(validateSchedule({ ...base({ tasks: [t], appointments: r.appointments }), blocks: r.blocks, breaks: r.breaks }).filter((p) => p.severity === 'error'), []);
  });
});

describe('time boundaries', () => {
  test('at 00:05 local on 25 Nov the plan starts on 25 Nov, not 24 Nov', () => {
    const r = generateSchedule(base({ now: '2026-11-25T00:05', tasks: [T('A', 60)] })); assert.equal(r.horizon.from, '2026-11-25'); assert.equal(r.blocks[0].start, '2026-11-25T09:00');
  });
  test('late evening rolls to the next working day; month and year boundaries work', () => {
    const r = generateSchedule(base({ now: '2026-12-31T23:55', horizonDays: 2, tasks: [T('A', 60)] })); assert.equal(r.horizon.to, '2027-01-01'); assert.equal(r.blocks[0].start, '2027-01-01T09:00');
  });
});

describe('determinism and invariants', () => {
  const scenario = () => { n = 100; return base({ horizonDays: 5, tasks: [T('A', 90, { dueDate: '2026-11-26' }), T('B', 200, { isSplittable: true, minimumSessionMinutes: 45 }), T('C', 45, { preferredTime: 'Afternoon' }), T('D', 120)], breaks: { enabled: true }, appointments: [{ id: 'm', title: 'M', startAt: '2026-11-25T10:00', endAt: '2026-11-25T11:30', travelBufferMinutes: 15 }] }); };
  test('same input => identical output, regardless of input order', () => {
    const one = generateSchedule(scenario()); const two = generateSchedule(scenario()); assert.deepEqual(one, two);
    const s = scenario(); s.tasks.reverse(); assert.deepEqual(generateSchedule(s).blocks, one.blocks);
  });
  test('the engine does not mutate its input', () => { const s = scenario(); const copy = structuredClone(s); generateSchedule(s); assert.deepEqual(s, copy); });
  test('1000 pseudo-random scenarios: always valid, scheduled minutes == remaining, nothing silently dropped', () => {
    let seed = 12345; const rnd = (k) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % k; };
    for (let i = 0; i < 1000; i++) {
      const tasks = Array.from({ length: 1 + rnd(7) }, (_, j) => { const est = 15 + 15 * rnd(16); const split = rnd(2) === 1; return T(`T${j}`, est, { isSplittable: split, minimumSessionMinutes: split ? 15 + 15 * rnd(3) : null, importance: ['Critical', 'High', 'Medium', 'Low'][rnd(4)], dueDate: rnd(3) ? `2026-11-${26 + rnd(4)}` : null, preferredTime: ['Anytime', 'Morning', 'Afternoon', 'Evening'][rnd(4)] }); });
      for (const t of tasks) if (t.isSplittable && t.minimumSessionMinutes > t.estimatedDurationMinutes) t.minimumSessionMinutes = t.estimatedDurationMinutes;
      if (tasks.length > 2 && rnd(2)) tasks[1].prerequisiteIds = [tasks[0].id];
      const appts = rnd(2) ? [{ id: 'a', title: 'A', startAt: `2026-11-2${5 + rnd(2)}T${String(9 + rnd(6)).padStart(2, '0')}:00`, endAt: `2026-11-2${5 + rnd(2)}T${String(16 + rnd(2)).padStart(2, '0')}:30`, travelBufferMinutes: rnd(3) * 10 }] : [];
      const ok = appts.filter((a) => toAbs(a.endAt) > toAbs(a.startAt));
      const input = base({ now: '2026-11-25T08:00', horizonDays: 4, tasks, appointments: ok, breaks: { enabled: !!rnd(2), minutes: 10, afterContinuousMinutes: 60 + rnd(60) } });
      const r = generateSchedule(input);
      assert.equal(hasErrors(validateSchedule({ ...input, blocks: r.blocks, breaks: r.breaks }, { errorsOnly: true })), false, `scenario ${i}`);
      const accounted = new Set([...r.unscheduled.map((u) => u.taskId), ...r.skipped.map((s) => s.taskId), ...r.blocks.map((b) => b.taskId)]); assert.equal(accounted.size, tasks.length, `silently dropped task in scenario ${i}`);
      for (const s of r.tasks) { const placedMin = s.scheduledMinutes; assert.ok(placedMin === 0 || placedMin === s.remainingMinutes, `partial schedule in scenario ${i}`); }
    }
  });
});

describe('validator (used for drag-and-drop and approval on the backend)', () => {
  const t = (extra) => T('X', 60, extra);
  const mk = (task, start, end, extra = {}) => ({ ...base({ tasks: [task], ...extra }), blocks: [{ taskId: task.id, start, end, durationMinutes: toAbs(end) - toAbs(start) }], breaks: [] });
  const codes = (v) => v.filter((p) => p.severity === 'error').map((p) => p.code);
  test('rejects overlap with an appointment (including its buffers)', () => {
    const task = t(); assert.ok(codes(validateSchedule(mk(task, '2026-11-25T10:30', '2026-11-25T11:30', { appointments: [{ id: 'a', title: 'A', startAt: '2026-11-25T11:00', endAt: '2026-11-25T12:00' }] }))).includes('overlap'));
    assert.ok(codes(validateSchedule(mk(task, '2026-11-25T12:00', '2026-11-25T13:00', { appointments: [{ id: 'a', title: 'A', startAt: '2026-11-25T11:00', endAt: '2026-11-25T12:00', travelBufferMinutes: 30 }] }))).includes('overlap'));
  });
  test('rejects outside working hours, the past, before the start date, completed tasks and splitting a non-splittable task', () => {
    assert.ok(codes(validateSchedule(mk(t(), '2026-11-25T18:00', '2026-11-25T19:00'))).includes('outside_working_hours'));
    assert.ok(codes(validateSchedule(mk(t(), '2026-11-25T07:00', '2026-11-25T08:00', { now: '2026-11-25T08:30', workingHours: { start: '06:00', end: '18:00', days: ALL_DAYS } }))).includes('in_the_past'));
    assert.ok(codes(validateSchedule(mk(t({ startDate: '2026-11-27' }), '2026-11-25T10:00', '2026-11-25T11:00'))).includes('before_start_date'));
    assert.ok(codes(validateSchedule(mk(t({ status: 'Completed' }), '2026-11-25T10:00', '2026-11-25T11:00'))).includes('task_not_active'));
    const task = t(); const v = mk(task, '2026-11-25T10:00', '2026-11-25T10:30'); v.blocks.push({ taskId: task.id, start: '2026-11-25T11:00', end: '2026-11-25T11:30', durationMinutes: 30 });
    assert.ok(codes(validateSchedule(v)).includes('split_not_allowed'));
  });
  test('rejects a move that breaks dependency order and warns (not errors) about a missed deadline', () => {
    const pre = t(); const dep = t({ prerequisiteIds: [pre.id], dueDate: '2026-11-25' });
    const input = { ...base({ tasks: [pre, dep], horizonDays: 3 }), breaks: [], blocks: [{ taskId: pre.id, start: '2026-11-25T14:00', end: '2026-11-25T15:00' }, { taskId: dep.id, start: '2026-11-25T10:00', end: '2026-11-25T11:00' }] };
    assert.ok(codes(validateSchedule(input)).includes('dependency_order'));
    const late = mk(t({ dueDate: '2026-11-25' }), '2026-11-26T10:00', '2026-11-26T11:00'); const v = validateSchedule({ ...late, horizonDays: 3 });
    assert.ok(v.some((p) => p.code === 'after_deadline' && p.severity === 'warning')); assert.deepEqual(codes(v), []);
  });
  test('rejects over-scheduling beyond the remaining duration', () => {
    const task = t({ isSplittable: true, minimumSessionMinutes: 15 }); assert.ok(codes(validateSchedule(mk(task, '2026-11-25T10:00', '2026-11-25T12:00'))).includes('over_scheduled'));
  });
});
