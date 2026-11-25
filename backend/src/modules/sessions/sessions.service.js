'use strict';
const { AppError } = require('../../errors/AppError');
const { parseLocalDateTime, formatLocalDateTime, parseDateOnly, toIso } = require('../../utils/dates');
const { updateInput } = require('./sessions.validator');

const notFound = () => new AppError({ status: 404, code: 'not_found', message: 'Focus session not found' });

const toPublicSession = (s) => ({
  id: s.id, sessionDateTime: formatLocalDateTime(s.sessionDateTime), availableTimeMinutes: s.availableTimeMinutes, longestFreeSlotMinutes: s.longestFreeSlotMinutes,
  currentTimePeriod: s.currentTimePeriod, energyLevel: s.energyLevel, focusLevel: s.focusLevel, createdAt: toIso(s.createdAt), updatedAt: toIso(s.updatedAt),
});
const toDb = (o) => (o.sessionDateTime ? { ...o, sessionDateTime: parseLocalDateTime(o.sessionDateTime) } : o);

function createSessionsService({ prisma }) {
  const find = async (userId, id) => {
    const s = await prisma.focusSession.findFirst({ where: { id, userId } });
    if (!s) throw notFound();
    return s;
  };
  return {
    find,
    async list(userId, { page, pageSize, from, to }) {
      const where = { userId };
      if (from || to) {
        where.sessionDateTime = {
          ...(from ? { gte: parseDateOnly(from) } : {}),
          ...(to ? { lt: new Date(parseDateOnly(to).getTime() + 86400000) } : {}),
        };
      }
      const [total, rows] = await Promise.all([
        prisma.focusSession.count({ where }),
        prisma.focusSession.findMany({ where, orderBy: [{ sessionDateTime: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { items: rows.map(toPublicSession), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
    },
    async get(userId, id) { return toPublicSession(await find(userId, id)); },
    async create(userId, input) { return toPublicSession(await prisma.focusSession.create({ data: { ...toDb(input), userId } })); },
    async update(userId, id, body) {
      const existing = toPublicSession(await find(userId, id));
      const patch = updateInput(body, existing);
      const res = await prisma.focusSession.updateMany({ where: { id, userId }, data: toDb(patch) });
      if (res.count !== 1) throw notFound();
      return toPublicSession(await find(userId, id));
    },
    /** Hard delete is safe: recommendation runs keep their own session snapshot (focusSessionId becomes NULL). */
    async remove(userId, id) {
      const res = await prisma.focusSession.deleteMany({ where: { id, userId } });
      if (res.count !== 1) throw notFound();
    },
  };
}
module.exports = { createSessionsService, toPublicSession };
