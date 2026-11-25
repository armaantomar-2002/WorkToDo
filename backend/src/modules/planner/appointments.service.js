'use strict';
const { AppError } = require('../../errors/AppError');
const { toIso } = require('../../utils/dates');
const { toWall, fromWall, dateOnly, addDays } = require('./wall');
const { toAbs } = require('../scheduler/time');

const lockUser = async (tx, userId) => { if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`; };
const notFound = () => new AppError({ status: 404, code: 'not_found', message: 'Appointment not found' });

const toPublic = (a) => ({
  id: a.id, title: a.title, description: a.description ?? null, location: a.location ?? null, startAt: toWall(a.startAt), endAt: toWall(a.endAt),
  durationMinutes: Math.round((a.endAt - a.startAt) / 60000), preparationBufferMinutes: a.preparationBufferMinutes, travelBufferMinutes: a.travelBufferMinutes,
  importance: a.importance, consequenceOfDelay: a.consequenceOfDelay, status: a.status, cancelledAt: toIso(a.cancelledAt), revision: a.revision, createdAt: toIso(a.createdAt), updatedAt: toIso(a.updatedAt),
});
const toHistory = (h) => ({ id: h.id, action: h.action, previousStartAt: toWall(h.previousStartAt), previousEndAt: toWall(h.previousEndAt), newStartAt: toWall(h.newStartAt), newEndAt: toWall(h.newEndAt), previousTitle: h.previousTitle ?? null, note: h.note ?? null, createdAt: toIso(h.createdAt) });

/**
 * Fixed appointments. They are the ONE thing the planner never moves: the scheduler only plans around them, and changing one never
 * edits an approved schedule silently: the response reports which planned blocks it affects so the user can recalculate.
 */
function createAppointmentsService({ prisma }) {
  const span = (a) => ({ s: toAbs(a.startAt), e: toAbs(a.endAt) });

  async function assertNoOverlap(db, userId, startAt, endAt, exceptId) {
    const rows = await db.appointment.findMany({ where: { userId, status: 'scheduled', startAt: { lt: fromWall(endAt) }, endAt: { gt: fromWall(startAt) } } });
    const clash = rows.filter((r) => r.id !== exceptId);
    if (clash.length) throw new AppError({ status: 409, code: 'appointment_conflict', message: `This time overlaps ${clash.map((c) => `"${c.title}"`).join(', ')}.`, errors: clash.map((c) => ({ field: 'startAt', message: `overlaps "${c.title}" (${toWall(c.startAt)} - ${toWall(c.endAt)})` })) });
  }

  /** Planned blocks (approved + draft) that now collide with the appointment including its buffers. Informational only. */
  async function impact(db, userId, a) {
    const s = toAbs(a.startAt) - a.preparationBufferMinutes - a.travelBufferMinutes; const e = toAbs(a.endAt) + a.travelBufferMinutes;
    const blocks = await db.scheduledBlock.findMany({ where: { userId, startAt: { lt: new Date(e * 60000) }, endAt: { gt: new Date(s * 60000) } } });
    if (!blocks.length) return { affectedBlocks: 0, recalculationSuggested: false };
    const versions = await db.scheduleVersion.findMany({ where: { userId, status: { in: ['approved', 'draft'] } } });
    const live = new Map(versions.map((v) => [v.id, v.status]));
    const hit = blocks.filter((b) => live.has(b.scheduleVersionId));
    return { affectedBlocks: hit.length, approvedBlocks: hit.filter((b) => live.get(b.scheduleVersionId) === 'approved').length, draftBlocks: hit.filter((b) => live.get(b.scheduleVersionId) === 'draft').length, recalculationSuggested: hit.length > 0 };
  }

  const owned = async (db, userId, id) => { const a = await db.appointment.findFirst({ where: { id, userId } }); if (!a) throw notFound(); return a; };

  return {
    async create(userId, input) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        await assertNoOverlap(tx, userId, input.startAt, input.endAt);
        let a;
        try { a = await tx.appointment.create({ data: { userId, ...input, startAt: fromWall(input.startAt), endAt: fromWall(input.endAt) } }); }
        catch (e) { if (e && e.code === 'P2002') throw new AppError({ status: 409, code: 'duplicate_request', message: 'Duplicate request' }); throw e; }
        await tx.appointmentHistory.create({ data: { appointmentId: a.id, userId, action: 'created', newStartAt: a.startAt, newEndAt: a.endAt } });
        return { appointment: toPublic(a), impact: await impact(tx, userId, toPublic(a)) };
      });
    },

    async update(userId, id, patch) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const cur = await owned(tx, userId, id);
        if (cur.status === 'cancelled') throw new AppError({ status: 409, code: 'invalid_transition', message: 'A cancelled appointment cannot be edited' });
        if (patch.revision !== undefined && patch.revision !== cur.revision) throw new AppError({ status: 409, code: 'stale_revision', message: 'This appointment was changed elsewhere. Reload and try again.' });
        const { revision: _r, ...fields } = patch;
        const startAt = fields.startAt ?? toWall(cur.startAt); const endAt = fields.endAt ?? toWall(cur.endAt);
        const m = (fromWall(endAt) - fromWall(startAt)) / 60000;
        if (!(m > 0) || m > 1440) throw new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors: [{ field: 'endAt', message: m > 0 ? 'an appointment cannot be longer than 24 hours' : 'must be after the start time' }] });
        const moved = startAt !== toWall(cur.startAt) || endAt !== toWall(cur.endAt);
        if (moved) await assertNoOverlap(tx, userId, startAt, endAt, id);
        const data = { ...fields, startAt: fromWall(startAt), endAt: fromWall(endAt), revision: cur.revision + 1 };
        const claimed = await tx.appointment.updateMany({ where: { id, userId, status: 'scheduled', revision: cur.revision }, data });
        if (claimed.count !== 1) throw new AppError({ status: 409, code: 'stale_revision', message: 'This appointment was changed elsewhere. Reload and try again.' });
        await tx.appointmentHistory.create({ data: { appointmentId: id, userId, action: moved ? 'rescheduled' : 'updated', previousStartAt: cur.startAt, previousEndAt: cur.endAt, newStartAt: fromWall(startAt), newEndAt: fromWall(endAt), previousTitle: fields.title && fields.title !== cur.title ? cur.title : null } });
        const a = await tx.appointment.findFirst({ where: { id, userId } });
        return { appointment: toPublic(a), impact: await impact(tx, userId, toPublic(a)) };
      });
    },

    async cancel(userId, id, { reason } = {}) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const cur = await owned(tx, userId, id);
        const claimed = await tx.appointment.updateMany({ where: { id, userId, status: 'scheduled' }, data: { status: 'cancelled', cancelledAt: new Date(), revision: cur.revision + 1 } });
        if (claimed.count !== 1) throw new AppError({ status: 409, code: 'invalid_transition', message: 'This appointment is already cancelled' });
        await tx.appointmentHistory.create({ data: { appointmentId: id, userId, action: 'cancelled', previousStartAt: cur.startAt, previousEndAt: cur.endAt, note: reason ?? null } });
        const a = await tx.appointment.findFirst({ where: { id, userId } });
        return { appointment: toPublic(a), impact: { affectedBlocks: 0, recalculationSuggested: true, note: 'The time is released. Recalculate the schedule to use it.' } };
      });
    },

    async get(userId, id) { return toPublic(await owned(prisma, userId, id)); },
    async history(userId, id) { await owned(prisma, userId, id); const rows = await prisma.appointmentHistory.findMany({ where: { appointmentId: id, userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }); return rows.map(toHistory); },
    async list(userId, { from, to, status } = {}) {
      const where = { userId };
      if (status) where.status = status;
      if (from) where.endAt = { gt: fromWall(`${from}T00:00`) };
      if (to) where.startAt = { lt: fromWall(`${addDays(to, 1)}T00:00`) };
      const rows = await prisma.appointment.findMany({ where, orderBy: [{ startAt: 'asc' }, { id: 'asc' }], take: 500 });
      return rows.map(toPublic);
    },

    // ---- manually blocked periods (user unavailable) ----
    async createUnavailable(userId, input) {
      const row = await prisma.unavailablePeriod.create({ data: { userId, label: input.label, startAt: fromWall(input.startAt), endAt: fromWall(input.endAt) } });
      return { id: row.id, label: row.label, startAt: toWall(row.startAt), endAt: toWall(row.endAt) };
    },
    async listUnavailable(userId, { from, to } = {}) {
      const where = { userId };
      if (from) where.endAt = { gt: fromWall(`${from}T00:00`) };
      if (to) where.startAt = { lt: fromWall(`${addDays(to, 1)}T00:00`) };
      const rows = await prisma.unavailablePeriod.findMany({ where, orderBy: [{ startAt: 'asc' }, { id: 'asc' }], take: 500 });
      return rows.map((r) => ({ id: r.id, label: r.label, startAt: toWall(r.startAt), endAt: toWall(r.endAt) }));
    },
    async removeUnavailable(userId, id) {
      const r = await prisma.unavailablePeriod.deleteMany({ where: { id, userId } });
      if (r.count !== 1) throw new AppError({ status: 404, code: 'not_found', message: 'Unavailable period not found' });
    },
  };
}
module.exports = { createAppointmentsService, toPublicAppointment: toPublic, lockUser };
