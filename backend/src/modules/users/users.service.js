'use strict';
const { AppError } = require('../../errors/AppError');
const { verifyPassword } = require('../../auth/password');
const { toPublicUser, toPublicPreferences } = require('./user.mapper');

const nothingToUpdate = () => new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors: [{ field: 'body', message: 'must contain at least one field to update' }] });

function createUsersService({ prisma }) {
  const getUser = async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError({ status: 401, code: 'unauthorized', message: 'Authentication required' });
    return user;
  };
  return {
    getUser,
    async getMe(userId) { return toPublicUser(await getUser(userId)); },

    async updateMe(userId, { fullName, email, currentPassword }) {
      if (fullName === undefined && email === undefined) throw nothingToUpdate();
      const user = await getUser(userId);
      const data = {};
      if (fullName !== undefined) data.fullName = fullName;
      if (email !== undefined && email !== user.email) {
        if (!currentPassword || !(await verifyPassword(user.passwordHash, currentPassword))) {
          throw new AppError({ status: 403, code: 'invalid_current_password', message: 'Current password is required to change your email address' });
        }
        data.email = email;
        data.isEmailVerified = false;
      }
      try {
        return toPublicUser(await prisma.user.update({ where: { id: userId }, data }));
      } catch (err) {
        if (err && err.code === 'P2002') throw new AppError({ status: 409, code: 'email_taken', message: 'An account with this email already exists' });
        throw err;
      }
    },

    async getPreferences(userId) {
      const prefs = await prisma.userPreferences.upsert({ where: { userId }, update: {}, create: { userId } });
      return toPublicPreferences(prefs);
    },
    async updatePreferences(userId, patch) {
      if (Object.keys(patch).length === 0) throw nothingToUpdate();
      if (patch.workDayStart !== undefined || patch.workDayEnd !== undefined) {
        const cur = await prisma.userPreferences.findUnique({ where: { userId } });
        const start = patch.workDayStart ?? cur?.workDayStart ?? '09:00'; const end = patch.workDayEnd ?? cur?.workDayEnd ?? '18:00';
        if (end <= start) throw new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors: [{ field: 'workDayEnd', message: 'must be later than the start of the working day' }] });
      }
      return toPublicPreferences(await prisma.userPreferences.upsert({ where: { userId }, update: patch, create: { userId, ...patch } }));
    },
  };
}
module.exports = { createUsersService };
