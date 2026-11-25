'use strict';
const { AppError } = require('../errors/AppError');
const { verifyAccessToken } = require('./tokens');

const unauthorized = (message = 'Authentication required') => new AppError({ status: 401, code: 'unauthorized', message });

/** Verifies the Bearer access token AND that its session (refresh-token family) is still active in the database. */
function requireAuth({ prisma, config }) {
  return async function authenticate(req, res, next) {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(header) : null;
    if (!match) return next(unauthorized());
    const claims = await verifyAccessToken(match[1], config.auth);
    if (!claims) return next(unauthorized('Access token is invalid or expired'));
    const live = await prisma.authSession.findFirst({
      where: { familyId: claims.familyId, userId: claims.userId, revokedAt: null, expiresAt: { gt: new Date() }, user: { isActive: true } },
      select: { id: true },
    });
    if (!live) return next(unauthorized('Session is no longer active'));
    req.auth = { userId: claims.userId, familyId: claims.familyId };
    return next();
  };
}

module.exports = { requireAuth, unauthorized };
