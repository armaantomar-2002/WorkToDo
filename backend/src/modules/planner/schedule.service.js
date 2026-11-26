'use strict';
const { AppError } = require('../../errors/AppError');
const { generateSchedule } = require('../scheduler/engine');
const { validateSchedule } = require('../scheduler/validate');
const { toAbs, fromAbs, DAY, dayOf, subtractIntervals } = require('../scheduler/time');
const { toIso } = require('../../utils/dates');
const { loadContext, engineInput, prefsOf } = require('./context');
const { lockUser } = require('./appointments.service');
const { toWall, fromWall, dateOnly, formatDateOnly, periodOfHour, addDays } = require('./wall');

const conflict = (code, message, extra) => new AppError({ status: 409, code, message, ...extra });
const notFound = () => new AppError({ status: 404, code: 'not_found', message: 'Schedule not found' });
const dur = (b) => toAbs(b.end) - toAbs(b.start);

const blockOut = (b, names) => ({
  id: b.id, kind: b.kind, taskId: b.taskId ?? null, taskName: b.kind === 'task' ? (names.get(b.taskId) ?? b.taskNameSnapshot ?? 'Task') : 'Break',
  start: toWall(b.startAt), end: toWall(b.endAt), durationMinutes: Math.round((b.endAt - b.startAt) / 60000), sessionIndex: b.sessionIndex, sessionCount: b.sessionCount,
  source: b.source, status: b.status, reason: b.reason ?? null, warnings: b.warnings ?? [],
});
/** Engine-form block (strings) from a DB row. */
const engineBlock = (b) => ({ id: b.id, kind: b.kind, taskId: b.taskId ?? undefined, start: toWall(b.startAt), end: toWall(b.endAt), status: b.status, source: b.source });

function createScheduleService({ prisma, runsService, now = () => new Date() }) {
  const versionOut = (v) => ({
    id: v.id, versionNumber: v.versionNumber, status: v.status, revision: v.revision, mode: v.mode, orderSource: v.orderSource, horizon: { from: formatDateOnly(v.horizonFrom), to: formatDateOnly(v.horizonTo) },
    generatedAt: toWall(v.generatedAtLocal), createdAt: toIso(v.createdAt), approvedAt: toIso(v.approvedAt), rejectedAt: toIso(v.rejectedAt), supersededAt: toIso(v.supersededAt), basedOnId: v.basedOnId ?? null, recommendationRunId: v.recommendationRunId ?? null,
  });

  const ownedVersion = async (db, userId, id) => { const v = await db.scheduleVersion.findFirst({ where: { id, userId } }); if (!v) throw notFound(); return v; };

  /** Validation input for a set of engine-form blocks against the CURRENT constraints. */
  const validateBlocks = (ctx, blocks, opts = {}) => {
    const input = engineInput(ctx);
    return validateSchedule({ ...input, blocks: blocks.filter((b) => b.kind === 'task'), breaks: blocks.filter((b) => b.kind === 'break') }, opts);
  };
  const errorsOf = (problems) => problems.filter((p) => p.severity === 'error');
  const keyOf = (p) => `${p.code}|${p.taskId ?? ''}|${p.message}`;

  /** Kept blocks for re-planning: future, still valid against today's constraints. Anything invalid is dropped so the engine re-places it. */
  function keepFromApproved(ctx, rows) {
    const nowAbs = toAbs(ctx.nowLocal); const active = new Set(ctx.tasks.map((t) => t.id));
    let cands = rows.filter((b) => b.status !== 'skipped' && toAbs(toWall(b.startAt)) >= nowAbs && (b.kind === 'break' || active.has(b.taskId))).map(engineBlock);
    for (let i = 0; i < 8; i++) {
      const errs = errorsOf(validateBlocks(ctx, cands, { errorsOnly: true }));
      if (!errs.length) break;
      const bad = new Set(errs.map((e) => e.taskId).filter(Boolean));
      if (bad.size) cands = cands.filter((b) => !(b.taskId && bad.has(b.taskId)));
      else { const hadSuggested = cands.some((b) => b.kind === 'break' && b.status !== 'accepted'); cands = cands.filter((b) => b.kind !== 'break' || (hadSuggested ? b.status === 'accepted' : false)); }
    }
    return cands;
  }

  const renumber = (blocks) => {
    const by = new Map();
    for (const b of blocks.filter((x) => x.kind === 'task')) { if (!by.has(b.taskId)) by.set(b.taskId, []); by.get(b.taskId).push(b); }
    for (const list of by.values()) { list.sort((a, b) => (a.start < b.start ? -1 : 1)); list.forEach((b, i) => { b.sessionIndex = i + 1; b.sessionCount = list.length; }); }
  };

  /** Runs the engine for the given context. `kept` = engine-form blocks that must not move. `only` = restrict planning to these task ids. */
  function plan(ctx, kept, { ranking, only } = {}) {
    const input = engineInput(ctx, { ranking });
    if (only) input.tasks = ctx.tasks.map((t) => (only.has(t.id) ? t : { ...t, completedMinutes: t.estimatedDurationMinutes }));
    input.lockedBlocks = kept.map((b) => ({ taskId: b.kind === 'task' ? b.taskId : undefined, start: b.start, end: b.end, kind: b.kind }));
    const result = generateSchedule(input);
    const all = [
      ...kept.map((b) => ({ ...b, source: b.source === 'user' ? 'user' : 'kept' })),
      ...result.blocks.map((b) => ({ kind: 'task', taskId: b.taskId, start: b.start, end: b.end, source: 'engine', status: 'planned', reason: b.reason, warnings: b.warnings })),
      ...result.breaks.map((b) => ({ kind: 'break', start: b.start, end: b.end, source: 'engine', status: 'suggested', reason: b.reason })),
    ];
    renumber(all);
    return { result, blocks: all };
  }

  const mlSession = (ctx, over = {}) => {
    const today = ctx.nowLocal.slice(0, 10);
    const free = subtractIntervals(workingWindowsFor(ctx, today), occupied(ctx)).map((f) => ({ s: Math.max(f.start, toAbs(ctx.nowLocal)), e: f.end })).filter((f) => f.e > f.s);
    const total = free.reduce((s, f) => s + (f.e - f.s), 0); const longest = free.reduce((m, f) => Math.max(m, f.e - f.s), 0);
    return { localTime: `${ctx.nowLocal.replace('T', ' ')}:00`, availableTimeMinutes: Math.max(1, Math.min(total, 1440)), longestFreeSlotMinutes: Math.min(longest, Math.max(1, Math.min(total, 1440))),
      currentTimePeriod: periodOfHour(Number(ctx.nowLocal.slice(11, 13))), energyLevel: over.energyLevel ?? ctx.prefs.energy, focusLevel: over.focusLevel ?? ctx.prefs.focus };
  };

  async function view(db, userId, v, instant = now()) {
    const rows = await db.scheduledBlock.findMany({ where: { scheduleVersionId: v.id, userId }, orderBy: [{ startAt: 'asc' }, { id: 'asc' }] });
    const window = { from: formatDateOnly(v.horizonFrom), to: formatDateOnly(v.horizonTo) };
    const ctx = await loadContext(db, userId, instant, window);
    const names = new Map(ctx.tasks.map((t) => [t.id, t.taskName]));
    const live = v.status === 'draft' || v.status === 'approved';
    const nowAbs = toAbs(ctx.nowLocal);
    const eb = rows.map(engineBlock);
    const considered = v.status === 'approved' ? eb.filter((b) => b.status !== 'skipped' && toAbs(b.start) >= nowAbs) : v.status === 'draft' ? eb : [];
    const problems = live ? validateBlocks(ctx, considered, { allowPast: v.status === 'approved' }) : [];
    const summary = v.summary ?? {};
    const plannedBy = new Map();
    for (const b of considered) if (b.kind === 'task') plannedBy.set(b.taskId, (plannedBy.get(b.taskId) ?? 0) + dur(b));
    const unscheduled = live ? ctx.tasks.filter((t) => t.estimatedDurationMinutes - t.completedMinutes > (plannedBy.get(t.id) ?? 0)).map((t) => {
      const remaining = t.estimatedDurationMinutes - t.completedMinutes;
      const why = (summary.unscheduled ?? []).find((u) => u.taskId === t.id);
      return { taskId: t.id, taskName: t.taskName, remainingMinutes: remaining, scheduledMinutes: plannedBy.get(t.id) ?? 0, code: why?.code ?? 'not_in_schedule', message: why?.message ?? (v.status === 'approved' ? 'Not part of this approved schedule (added or changed later). Generate a new draft to include it.' : 'Not scheduled in this draft.') };
    }) : [];
    let stale = null;
    if (v.status === 'draft') {
      const parts = summary.hashParts ?? {}; const changed = Object.keys(ctx.hashParts).filter((k) => parts[k] !== ctx.hashParts[k]);
      stale = { isStale: changed.length > 0, changed };
    }
    const needsRecalculation = v.status === 'approved' ? (errorsOf(problems).length > 0 || unscheduled.length > 0) : false;
    const taskSummaries = ctx.tasks.map((t) => ({ taskId: t.id, taskName: t.taskName, estimatedMinutes: t.estimatedDurationMinutes, completedMinutes: t.completedMinutes, remainingMinutes: Math.max(0, t.estimatedDurationMinutes - t.completedMinutes), scheduledMinutes: plannedBy.get(t.id) ?? 0 }));
    const busy = [...ctx.appointments.map((a) => spanOf(a)), ...ctx.unavailable.map((u) => ({ start: toAbs(u.startAt), end: toAbs(u.endAt) })), ...considered.map((b) => ({ start: toAbs(b.start), end: toAbs(b.end) }))];
    const windows = []; for (let d = dayOf(toAbs(`${window.from}T00:00`)); d <= dayOf(toAbs(`${window.to}T00:00`)); d++) { const w = dayWindow(ctx, d); if (w) windows.push(w); }
    const freeSlots = subtractIntervals(windows, busy).map((f) => ({ start: fromAbs(Math.max(f.start, nowAbs)), end: fromAbs(f.end) })).filter((f) => toAbs(f.end) > toAbs(f.start)).map((f) => ({ ...f, durationMinutes: toAbs(f.end) - toAbs(f.start) }));
    // ONE ordered timeline (task sessions, breaks and fixed appointments) -- the Recommendations page and the Planner both render exactly this list.
    const timeline = buildTimeline({ rows, ctx, window, names, nowAbs, live: v.status === 'approved' });
    return {
      schedule: versionOut(v), timeline, infeasibilities: live ? summary.infeasibilities ?? [] : [], blocks: rows.map((b) => blockOut(b, names)), appointments: ctx.appointments, unavailable: ctx.unavailable, problems, unscheduled, skipped: summary.skipped ?? [],
      stale, needsRecalculation, taskSummaries, freeSlots, workingHours: ctx.prefs.workingHours, timeZone: ctx.prefs.timeZone, now: ctx.nowLocal, notes: { ml: summary.mlNote ?? null },
    };
  }
  function buildTimeline({ rows, ctx, window, names, nowAbs, live }) {
    const prereqsOf = (taskId) => (ctx.tasks.find((t) => t.id === taskId)?.prerequisiteIds ?? []).map((pid) => ctx.tasks.find((t) => t.id === pid)).filter(Boolean).map((p) => ({ taskId: p.id, taskName: p.taskName, status: p.status }));
    const taskOfAppt = new Map(ctx.tasks.filter((t) => t.appointmentId).map((t) => [t.appointmentId, t]));
    const items = [];
    for (const b of rows) {
      const start = toWall(b.startAt); const end = toWall(b.endAt);
      if (live && toAbs(end) < nowAbs) continue; // an approved schedule's timeline starts now
      items.push({ key: `block:${b.id}`, kind: b.kind === 'break' ? 'break' : 'task', blockId: b.id, taskId: b.taskId ?? null, appointmentId: null, title: b.kind === 'task' ? (names.get(b.taskId) ?? b.taskNameSnapshot ?? 'Task') : 'Break',
        start, end, durationMinutes: Math.round((b.endAt - b.startAt) / 60000), sessionIndex: b.sessionIndex, sessionCount: b.sessionCount, status: b.status, source: b.source, reason: b.reason ?? null, warnings: b.warnings ?? [],
        prerequisites: b.kind === 'task' ? prereqsOf(b.taskId) : [] });
    }
    for (const a of ctx.appointments) {
      if (a.endAt.slice(0, 10) < window.from || a.startAt.slice(0, 10) > window.to || toAbs(a.endAt) < nowAbs) continue;
      const t = taskOfAppt.get(a.id);
      items.push({ key: `appt:${a.id}`, kind: 'fixed', blockId: null, taskId: t?.id ?? null, appointmentId: a.id, title: a.title, start: a.startAt, end: a.endAt, durationMinutes: toAbs(a.endAt) - toAbs(a.startAt), sessionIndex: 1, sessionCount: 1,
        status: 'fixed', source: 'appointment', reason: 'Fixed commitment — its time is never moved automatically.', warnings: [], prerequisites: t ? prereqsOf(t.id) : [] });
    }
    const rank = { fixed: 0, task: 1, break: 2 };
    return items.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.end < y.end ? -1 : x.end > y.end ? 1 : rank[x.kind] - rank[y.kind] || (x.key < y.key ? -1 : 1)));
  }
  const spanOf = (a) => ({ start: toAbs(a.startAt) - (a.preparationBufferMinutes ?? 0) - (a.travelBufferMinutes ?? 0), end: toAbs(a.endAt) + (a.travelBufferMinutes ?? 0) });
  const dayWindow = (ctx, d) => { const wh = ctx.prefs.workingHours; if (!wh.days.includes(((d + 4) % 7 + 7) % 7)) return null; const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); return { start: d * DAY + m(wh.start), end: d * DAY + m(wh.end) }; };
  const workingWindowsFor = (ctx, dayKey) => { const w = dayWindow(ctx, dayOf(toAbs(`${dayKey}T00:00`))); return w ? [w] : []; };
  const occupied = (ctx) => [...ctx.appointments.map(spanOf), ...ctx.unavailable.map((u) => ({ start: toAbs(u.startAt), end: toAbs(u.endAt) }))];

  const persistBlocks = (tx, v, blocks, names) => tx.scheduledBlock.createMany({ data: blocks.map((b) => ({
    scheduleVersionId: v.id, userId: v.userId, kind: b.kind, taskId: b.kind === 'task' ? b.taskId : null, taskNameSnapshot: b.kind === 'task' ? names.get(b.taskId) ?? null : null,
    startAt: fromWall(b.start), endAt: fromWall(b.end), sessionIndex: b.sessionIndex ?? 1, sessionCount: b.sessionCount ?? 1, source: b.source ?? 'engine', status: b.status ?? 'planned', reason: b.reason ?? null, warnings: b.warnings ?? [],
  })) });

  const bump = async (tx, v, expected) => {
    const r = await tx.scheduleVersion.updateMany({ where: { id: v.id, userId: v.userId, status: 'draft', revision: expected }, data: { revision: expected + 1 } });
    if (r.count !== 1) throw conflict('stale_revision', 'This draft was changed elsewhere. Reload it and try again.');
  };
  const requireDraft = (v) => { if (v.status !== 'draft') throw conflict('invalid_transition', `Only a draft can be edited (this schedule is ${v.status}).`); };

  return {
    /** Generates a NEW draft. Never touches the approved schedule. mode: minimal (keep valid future approved blocks), fresh (plan everything), clone (copy approved as-is for manual editing). */
    async generateDraft(userId, { mode = 'minimal', useMl = true, replace = false, energyLevel, focusLevel } = {}) {
      const instant = now();
      let ranking; let runId = null; let mlNote = null;
      const ctx0 = await loadContext(prisma, userId, instant);
      if (useMl && mode !== 'clone' && runsService && ctx0.tasks.length) {
        try { const run = await runsService.create(userId, mlSession(ctx0, { energyLevel, focusLevel })); ranking = run.ranked.map((r) => ({ taskId: r.taskId, rank: r.rank })); runId = run.run.id; }
        catch (e) { mlNote = `The recommendation service was unavailable (${e && e.code ? e.code : 'error'}); tasks were ordered by due date and importance instead.`; }
      } else if (useMl && mode !== 'clone' && !runsService) mlNote = 'Recommendation service not configured; tasks were ordered by due date and importance.';
      try {
        return await prisma.$transaction(async (tx) => {
          await lockUser(tx, userId);
          const existing = await tx.scheduleVersion.findFirst({ where: { userId, status: 'draft' } });
          if (existing) {
            if (!replace) throw conflict('draft_exists', 'You already have an open draft. Approve or reject it, or replace it.', { errors: [{ field: 'draftId', message: existing.id }] });
            await tx.scheduleVersion.updateMany({ where: { id: existing.id, userId, status: 'draft' }, data: { status: 'rejected', rejectedAt: new Date() } });
          }
          const ctx = await loadContext(tx, userId, instant);
          const approved = await tx.scheduleVersion.findFirst({ where: { userId, status: 'approved' } });
          const approvedRows = approved ? await tx.scheduledBlock.findMany({ where: { scheduleVersionId: approved.id, userId } }) : [];
          const kept = mode === 'fresh' ? [] : keepFromApproved(ctx, approvedRows);
          let blocks; let result = { unscheduled: [], skipped: [], infeasibilities: [], orderSource: 'fallback' };
          if (mode === 'clone') { blocks = kept.map((b) => ({ ...b })); renumber(blocks); }
          else { const p = plan(ctx, kept, { ranking: ranking?.length ? ranking : undefined }); blocks = p.blocks; result = p.result; }
          const merged = errorsOf(validateBlocks(ctx, blocks, { errorsOnly: true }));
          if (merged.length) throw new AppError({ status: 500, code: 'scheduler_invariant', message: 'The scheduler produced an invalid plan and nothing was saved.', logContext: { problems: merged.slice(0, 5) } });
          const last = await tx.scheduleVersion.findFirst({ where: { userId }, orderBy: [{ versionNumber: 'desc' }] });
          const v = await tx.scheduleVersion.create({ data: {
            userId, versionNumber: (last?.versionNumber ?? 0) + 1, status: 'draft', mode, orderSource: ranking?.length ? 'ml' : 'fallback', horizonFrom: dateOnly(ctx.window.from), horizonTo: dateOnly(ctx.window.to),
            generatedAtLocal: fromWall(ctx.nowLocal), inputHash: ctx.hash, basedOnId: approved?.id ?? null, recommendationRunId: runId,
            summary: { unscheduled: result.unscheduled, skipped: result.skipped, infeasibilities: result.infeasibilities ?? [], hashParts: ctx.hashParts, mlNote, keptBlocks: kept.length },
          } });
          await persistBlocks(tx, v, blocks, new Map(ctx.tasks.map((t) => [t.id, t.taskName])));
          return view(tx, userId, v, instant);
        });
      } catch (e) {
        if (e && e.code === 'P2002') throw conflict('concurrent_generation', 'A draft is already being created. Reload and try again.');
        throw e;
      }
    },

    /**
     * Called after a task, dependency, appointment, availability or preference change. NEVER approves anything and never moves an appointment:
     * if the user has an active schedule or a draft whose inputs changed, a fresh DRAFT is generated for review (replacing a stale draft).
     */
    async refreshDraftIfNeeded(userId) {
      const open = await prisma.scheduleVersion.findMany({ where: { userId, status: { in: ['draft', 'approved'] } } });
      if (!open.length) return null;
      const ctx = await loadContext(prisma, userId, now());
      const draft = open.find((v) => v.status === 'draft'); const approved = open.find((v) => v.status === 'approved');
      const same = (v) => { const parts = (v.summary ?? {}).hashParts ?? {}; return Object.keys(ctx.hashParts).every((k) => parts[k] === ctx.hashParts[k]); };
      if (draft ? same(draft) : same(approved)) return null; // nothing relevant changed
      return this.generateDraft(userId, { mode: approved ? 'minimal' : 'fresh', useMl: true, replace: true });
    },

    async list(userId) {
      const rows = await prisma.scheduleVersion.findMany({ where: { userId }, orderBy: [{ versionNumber: 'desc' }], take: 100 });
      return rows.map(versionOut);
    },
    async getOpen(userId, which) { // 'draft' | 'approved'
      const v = await prisma.scheduleVersion.findFirst({ where: { userId, status: which } });
      return v ? view(prisma, userId, v) : null;
    },
    async get(userId, id) { return view(prisma, userId, await ownedVersion(prisma, userId, id)); },

    /** What would change if this draft were approved, compared with the active approved schedule. */
    async diff(userId, id) {
      const v = await ownedVersion(prisma, userId, id);
      const approved = await prisma.scheduleVersion.findFirst({ where: { userId, status: 'approved' } });
      const keyOf2 = (b) => `${b.kind}|${b.taskId ?? ''}|${toWall(b.startAt)}|${toWall(b.endAt)}`;
      const mine = await prisma.scheduledBlock.findMany({ where: { scheduleVersionId: v.id, userId } });
      const base = approved && approved.id !== v.id ? await prisma.scheduledBlock.findMany({ where: { scheduleVersionId: approved.id, userId } }) : [];
      const nowAbs = toAbs((await loadContext(prisma, userId, now())).nowLocal);
      const future = (b) => toAbs(toWall(b.startAt)) >= nowAbs;
      const a = new Map(base.filter(future).map((b) => [keyOf2(b), b])); const b2 = new Map(mine.filter(future).map((b) => [keyOf2(b), b]));
      const names = new Map((await prisma.task.findMany({ where: { userId, id: { in: [...new Set([...mine, ...base].filter((x) => x.taskId).map((x) => x.taskId))] } } })).map((t) => [t.id, t.taskName]));
      const out = (rows) => rows.map((x) => blockOut(x, names));
      return { added: out([...b2].filter(([k]) => !a.has(k)).map(([, x]) => x)), removed: out([...a].filter(([k]) => !b2.has(k)).map(([, x]) => x)), unchanged: [...b2].filter(([k]) => a.has(k)).length };
    },

    /** Move (task session or break) within a DRAFT. preview=true validates without saving. Backend-enforced: nothing invalid is ever stored. */
    async moveBlock(userId, id, blockId, { start, end, revision, preview = false }) {
      const run = async (db) => {
        const v = await ownedVersion(db, userId, id); requireDraft(v);
        if (revision !== undefined && revision !== v.revision) throw conflict('stale_revision', 'This draft was changed elsewhere. Reload it and try again.');
        const rows = await db.scheduledBlock.findMany({ where: { scheduleVersionId: v.id, userId } });
        const target = rows.find((r) => r.id === blockId); if (!target) throw new AppError({ status: 404, code: 'not_found', message: 'Block not found' });
        const ctx = await loadContext(db, userId, now(), { from: formatDateOnly(v.horizonFrom), to: formatDateOnly(v.horizonTo) });
        const length = Math.round((target.endAt - target.startAt) / 60000);
        const newEnd = target.kind === 'break' && end ? end : fromAbs(toAbs(start) + length);
        if (target.kind === 'task' && end && toAbs(end) - toAbs(start) !== length) throw new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors: [{ field: 'end', message: 'a task session keeps its length; only its start can change' }] });
        const eb = rows.map(engineBlock); const before = errorsOf(validateBlocks(ctx, eb, {})).map(keyOf);
        const removedBreaks = [];
        let next = eb.map((b) => (b.id === blockId ? { ...b, start, end: newEnd, source: 'user', status: b.kind === 'break' ? 'accepted' : b.status } : b));
        // a suggested (not accepted) break that now collides with the moved block is simply dropped
        const moved = next.find((b) => b.id === blockId);
        if (moved.kind === 'task') { const drop = next.filter((b) => b.kind === 'break' && b.status === 'suggested' && toAbs(b.start) < toAbs(moved.end) && toAbs(moved.start) < toAbs(b.end)); drop.forEach((b) => removedBreaks.push(b.id)); next = next.filter((b) => !drop.includes(b)); }
        const problems = validateBlocks(ctx, next, {}); const introduced = errorsOf(problems).filter((p) => !before.includes(keyOf(p)));
        if (introduced.length) throw new AppError({ status: 422, code: 'schedule_conflict', message: introduced[0].message, errors: introduced.map((p) => ({ field: 'start', message: p.message })), logContext: undefined });
        if (preview) return { valid: true, preview: { id: blockId, from: { start: toWall(target.startAt), end: toWall(target.endAt) }, to: { start, end: newEnd }, removedBreaks, warnings: problems.filter((p) => p.severity === 'warning') } };
        await bump(db, v, v.revision);
        await db.scheduledBlock.updateMany({ where: { id: blockId, userId, scheduleVersionId: v.id }, data: { startAt: fromWall(start), endAt: fromWall(newEnd), source: 'user', ...(target.kind === 'break' ? { status: 'accepted' } : {}) } });
        if (removedBreaks.length) await db.scheduledBlock.deleteMany({ where: { id: { in: removedBreaks }, userId, scheduleVersionId: v.id } });
        const fresh = await db.scheduleVersion.findFirst({ where: { id: v.id, userId } });
        return { valid: true, ...(await view(db, userId, fresh)), removedBreaks };
      };
      return preview ? run(prisma) : prisma.$transaction(async (tx) => { await lockUser(tx, userId); return run(tx); });
    },

    async removeBlock(userId, id, blockId, { revision } = {}) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const v = await ownedVersion(tx, userId, id); requireDraft(v);
        if (revision !== undefined && revision !== v.revision) throw conflict('stale_revision', 'This draft was changed elsewhere. Reload it and try again.');
        const b = await tx.scheduledBlock.findFirst({ where: { id: blockId, userId, scheduleVersionId: v.id } });
        if (!b) throw new AppError({ status: 404, code: 'not_found', message: 'Block not found' });
        await bump(tx, v, v.revision);
        await tx.scheduledBlock.deleteMany({ where: { id: blockId, userId, scheduleVersionId: v.id } });
        return view(tx, userId, await tx.scheduleVersion.findFirst({ where: { id: v.id, userId } }));
      });
    },

    /** Add a manual break. If it overlaps task sessions: 409 unless replan=true, in which case ONLY the displaced sessions are re-planned. */
    async addBreak(userId, id, { start, end, revision, replan = false }) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const v = await ownedVersion(tx, userId, id); requireDraft(v);
        if (revision !== undefined && revision !== v.revision) throw conflict('stale_revision', 'This draft was changed elsewhere. Reload it and try again.');
        const rows = await tx.scheduledBlock.findMany({ where: { scheduleVersionId: v.id, userId } });
        const ctx = await loadContext(tx, userId, now(), { from: formatDateOnly(v.horizonFrom), to: formatDateOnly(v.horizonTo) });
        const mk = { id: 'new-break', kind: 'break', start, end, status: 'accepted', source: 'user' };
        const eb = rows.map(engineBlock);
        const hit = eb.filter((b) => b.kind === 'task' && toAbs(b.start) < toAbs(end) && toAbs(start) < toAbs(b.end));
        let blocks = [...eb, mk]; let moved = [];
        if (hit.length) {
          if (!replan) throw new AppError({ status: 409, code: 'break_conflict', message: `This break overlaps ${hit.length} planned session(s). Re-plan them around the break?`, errors: hit.map((b) => ({ field: 'start', message: `overlaps ${ctx.tasks.find((t) => t.id === b.taskId)?.taskName ?? 'a task'} ${b.start}-${b.end}` })) });
          const affected = new Set(hit.map((b) => b.taskId));
          const rest = eb.filter((b) => !hit.includes(b)).concat([mk]);
          const p = plan(ctx, rest, { only: affected });
          blocks = p.blocks; moved = [...affected];
        }
        const problems = errorsOf(validateBlocks(ctx, blocks, { errorsOnly: true })).filter((p) => !errorsOf(validateBlocks(ctx, eb, {})).map(keyOf).includes(keyOf(p)));
        if (problems.length) throw new AppError({ status: 422, code: 'schedule_conflict', message: problems[0].message, errors: problems.map((p) => ({ field: 'start', message: p.message })) });
        await bump(tx, v, v.revision);
        // replace the version's blocks atomically: delete + recreate keeps ids simple and the unique draft intact
        await tx.scheduledBlock.deleteMany({ where: { scheduleVersionId: v.id, userId } });
        await persistBlocks(tx, v, blocks.map((b) => ({ ...b, id: undefined })), new Map(ctx.tasks.map((t) => [t.id, t.taskName])));
        return { replanned: moved, ...(await view(tx, userId, await tx.scheduleVersion.findFirst({ where: { id: v.id, userId } }))) };
      });
    },

    async acceptBreak(userId, id, blockId, { revision } = {}) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const v = await ownedVersion(tx, userId, id); requireDraft(v);
        if (revision !== undefined && revision !== v.revision) throw conflict('stale_revision', 'This draft was changed elsewhere. Reload it and try again.');
        const r = await tx.scheduledBlock.updateMany({ where: { id: blockId, userId, scheduleVersionId: v.id, kind: 'break' }, data: { status: 'accepted' } });
        if (r.count !== 1) throw new AppError({ status: 404, code: 'not_found', message: 'Break not found' });
        await bump(tx, v, v.revision);
        return view(tx, userId, await tx.scheduleVersion.findFirst({ where: { id: v.id, userId } }));
      });
    },

    /** Approves the draft atomically. Fails (and leaves the approved schedule untouched) when the draft is stale, invalid, already decided, or another approval won the race. */
    async approve(userId, id, { revision } = {}) {
      try {
        return await prisma.$transaction(async (tx) => {
          await lockUser(tx, userId);
          const v = await ownedVersion(tx, userId, id);
          if (v.status !== 'draft') throw conflict('invalid_transition', `This schedule is already ${v.status}; only an open draft can be approved.`);
          if (revision !== undefined && revision !== v.revision) throw conflict('stale_revision', 'This draft was changed after you loaded it. Reload and review it again.');
          const ctx = await loadContext(tx, userId, now(), { from: formatDateOnly(v.horizonFrom), to: formatDateOnly(v.horizonTo) });
          const parts = (v.summary ?? {}).hashParts ?? {}; const changed = Object.keys(ctx.hashParts).filter((k) => parts[k] !== ctx.hashParts[k]);
          if (changed.length) throw conflict('draft_stale', `Your ${changed.join(', ')} changed since this draft was generated. Regenerate the draft before approving.`, { errors: changed.map((c) => ({ field: c, message: 'changed' })) });
          const rows = await tx.scheduledBlock.findMany({ where: { scheduleVersionId: v.id, userId } });
          const problems = errorsOf(validateBlocks(ctx, rows.map(engineBlock), {}));
          if (problems.length) throw new AppError({ status: 422, code: 'schedule_invalid', message: `The draft has ${problems.length} conflict(s): ${problems[0].message}`, errors: problems.map((p) => ({ field: 'blocks', message: p.message })) });
          const at = new Date();
          await tx.scheduleVersion.updateMany({ where: { userId, status: 'approved' }, data: { status: 'superseded', supersededAt: at } });
          const claimed = await tx.scheduleVersion.updateMany({ where: { id: v.id, userId, status: 'draft' }, data: { status: 'approved', approvedAt: at } });
          if (claimed.count !== 1) throw conflict('concurrent_approval', 'This draft was just decided in another request.');
          return view(tx, userId, await tx.scheduleVersion.findFirst({ where: { id: v.id, userId } }));
        });
      } catch (e) { if (e && e.code === 'P2002') throw conflict('concurrent_approval', 'Another approval was in progress. Reload and try again.'); throw e; }
    },

    async reject(userId, id) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const v = await ownedVersion(tx, userId, id);
        const r = await tx.scheduleVersion.updateMany({ where: { id: v.id, userId, status: 'draft' }, data: { status: 'rejected', rejectedAt: new Date() } });
        if (r.count !== 1) throw conflict('invalid_transition', `This schedule is already ${v.status}; only an open draft can be rejected.`);
        return { schedule: versionOut(await tx.scheduleVersion.findFirst({ where: { id: v.id, userId } })), approvedUntouched: true };
      });
    },

    /** Records that a planned session was skipped (approved schedule). History is kept; the plan itself is not rewritten. */
    async skipBlock(userId, id, blockId) {
      const v = await ownedVersion(prisma, userId, id);
      if (v.status !== 'approved') throw conflict('invalid_transition', 'Only sessions of the approved schedule can be marked skipped.');
      const r = await prisma.scheduledBlock.updateMany({ where: { id: blockId, userId, scheduleVersionId: v.id, kind: 'task', status: 'planned' }, data: { status: 'skipped' } });
      if (r.count !== 1) throw conflict('invalid_transition', 'This session is not planned (it may already be skipped).');
      return view(prisma, userId, v);
    },
  };
}
module.exports = { createScheduleService };
