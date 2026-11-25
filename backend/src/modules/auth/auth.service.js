'use strict';
const crypto = require('node:crypto');
const { AppError } = require('../../errors/AppError');
const { hashPassword, verifyPassword, burnPasswordCheck } = require('../../auth/password');
const { generateOpaqueToken, hashToken, signAccessToken } = require('../../auth/tokens');
const { toPublicUser } = require('../users/user.mapper');
const { toIso } = require('../../utils/dates');

const DAY_MS = 86400000;
const ROTATION_GRACE_MS = 10000; // a just-rotated token presented again within this window is a benign race (two tabs), not theft

const invalidCredentials = () => new AppError({ status: 401, code: 'invalid_credentials', message: 'Email or password is incorrect' });
const invalidRefresh = () => new AppError({ status: 401, code: 'invalid_refresh_token', message: 'Session has expired. Please sign in again.' });
const trimAgent = (ua) => (typeof ua === 'string' && ua ? ua.slice(0, 255) : null);

function createAuthService({ prisma, config, emailProvider, now = () => new Date() }) {
  const ttlMs = (rememberMe) => (rememberMe ? config.auth.rememberMeTtlDays : config.auth.refreshTokenTtlDays) * DAY_MS;

  async function openSession(db, { userId, rememberMe, userAgent, familyId = crypto.randomUUID(), id = crypto.randomUUID() }) {
    const { token, hash } = generateOpaqueToken();
    const expiresAt = new Date(now().getTime() + ttlMs(rememberMe));
    await db.authSession.create({ data: { id, userId, familyId, refreshTokenHash: hash, rememberMe, expiresAt, userAgent: trimAgent(userAgent), lastUsedAt: now() } });
    return { refreshToken: token, refreshMaxAgeSeconds: ttlMs(rememberMe) / 1000, familyId, sessionId: id };
  }

  async function issue(user, session) {
    return {
      user: toPublicUser(user),
      accessToken: await signAccessToken({ userId: user.id, familyId: session.familyId }, config.auth),
      expiresIn: config.auth.accessTokenTtlSeconds,
      refreshToken: session.refreshToken,
      refreshMaxAgeSeconds: session.refreshMaxAgeSeconds,
    };
  }

  const revokeFamily = (db, familyId) => db.authSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now() } });
  const revokeAllForUser = (db, userId, exceptFamilyId) =>
    db.authSession.updateMany({ where: { userId, revokedAt: null, ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}) }, data: { revokedAt: now() } });

  return {
    async register({ fullName, email, password, rememberMe = false }, { userAgent } = {}) {
      const taken = () => new AppError({ status: 409, code: 'email_taken', message: 'An account with this email already exists' });
      if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) throw taken();
      const passwordHash = await hashPassword(password);
      try {
        return await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({ data: { fullName, email, passwordHash, preferences: { create: {} } } });
          return issue(user, await openSession(tx, { userId: user.id, rememberMe, userAgent }));
        });
      } catch (err) {
        if (err && err.code === 'P2002') throw taken(); // lost a race with a concurrent registration
        throw err;
      }
    },

    async login({ email, password, rememberMe = false }, { userAgent } = {}) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) { await burnPasswordCheck(password); throw invalidCredentials(); }
      if (!(await verifyPassword(user.passwordHash, password))) throw invalidCredentials();
      return issue(user, await openSession(prisma, { userId: user.id, rememberMe, userAgent }));
    },

    /** Rotates the refresh token. Presenting an already-rotated token (outside the grace window) revokes the whole session family. */
    async refresh(rawToken, { userAgent } = {}) {
      if (typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 200) throw invalidRefresh();
      const row = await prisma.authSession.findUnique({ where: { refreshTokenHash: hashToken(rawToken) }, include: { user: true } });
      if (!row) throw invalidRefresh();
      if (row.revokedAt) {
        if (row.replacedById) {
          if (now().getTime() - row.revokedAt.getTime() < ROTATION_GRACE_MS) throw new AppError({ status: 401, code: 'refresh_race', message: 'Session was just refreshed; retry' });
          await revokeFamily(prisma, row.familyId); // reuse of a rotated token: assume theft, end the whole session
        }
        throw invalidRefresh();
      }
      if (row.expiresAt <= now() || !row.user.isActive) throw invalidRefresh();

      const nextId = crypto.randomUUID();
      return prisma.$transaction(async (tx) => {
        const claimed = await tx.authSession.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now(), replacedById: nextId, lastUsedAt: now() } });
        if (claimed.count !== 1) throw new AppError({ status: 401, code: 'refresh_race', message: 'Session was just refreshed; retry' });
        const session = await openSession(tx, { userId: row.userId, rememberMe: row.rememberMe, userAgent: userAgent ?? row.userAgent, familyId: row.familyId, id: nextId });
        return issue(row.user, session);
      });
    },

    /** Revokes the session family identified by the refresh cookie and/or the access token. Idempotent. */
    async logout({ refreshToken, familyId }) {
      const families = new Set();
      if (familyId) families.add(familyId);
      if (typeof refreshToken === 'string' && refreshToken) {
        const row = await prisma.authSession.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) }, select: { familyId: true } });
        if (row) families.add(row.familyId);
      }
      for (const f of families) await revokeFamily(prisma, f);
    },

    async changePassword(userId, familyId, { currentPassword, newPassword }) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
        throw new AppError({ status: 403, code: 'invalid_current_password', message: 'Current password is incorrect' });
      }
      if (currentPassword === newPassword) throw new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors: [{ field: 'newPassword', message: 'must be different from the current password' }] });
      const passwordHash = await hashPassword(newPassword);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { passwordHash } });
        await revokeAllForUser(tx, userId, familyId); // sign out every other device
      });
    },

    /** Always resolves the same way, whether or not the account exists (no account enumeration). */
    async forgotPassword({ email }) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) return;
      const { token, hash } = generateOpaqueToken();
      await prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now() } }); // invalidate older links
        await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: hash, expiresAt: new Date(now().getTime() + config.auth.passwordResetTtlMinutes * 60000) } });
      });
      const link = `${config.email.appUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
      await emailProvider.send({
        to: user.email, subject: 'Reset your WorkToDo password',
        text: `Use this link to choose a new password (valid for ${config.auth.passwordResetTtlMinutes} minutes):\n${link}\nIf you did not request this, ignore this message.`,
      });
    },

    async resetPassword({ token, newPassword }) {
      const bad = () => new AppError({ status: 400, code: 'invalid_reset_token', message: 'This reset link is invalid or has expired' });
      const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!row || row.usedAt || row.expiresAt <= now()) throw bad();
      const passwordHash = await hashPassword(newPassword);
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now() } });
        if (claimed.count !== 1) throw bad();
        await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
        await revokeAllForUser(tx, row.userId);
      });
    },

    async listSessions(userId, currentFamilyId) {
      const rows = await prisma.authSession.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: now() } }, orderBy: { lastUsedAt: 'desc' } });
      return rows.map((r) => ({ id: r.id, userAgent: r.userAgent, rememberMe: r.rememberMe, lastUsedAt: toIso(r.lastUsedAt), expiresAt: toIso(r.expiresAt), current: r.familyId === currentFamilyId }));
    },

    async revokeSession(userId, sessionId) {
      const row = await prisma.authSession.findFirst({ where: { id: sessionId, userId, revokedAt: null }, select: { familyId: true } });
      if (!row) throw new AppError({ status: 404, code: 'not_found', message: 'Session not found' });
      await revokeFamily(prisma, row.familyId);
      return { revokedCurrent: false, familyId: row.familyId };
    },

    async revokeOtherSessions(userId, familyId) {
      const r = await revokeAllForUser(prisma, userId, familyId);
      return { revoked: r.count };
    },
  };
}

module.exports = { createAuthService, ROTATION_GRACE_MS };
