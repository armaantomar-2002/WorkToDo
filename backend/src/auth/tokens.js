'use strict';
const crypto = require('node:crypto');

const ISSUER = 'worktodo-backend';
const AUDIENCE = 'worktodo-web';
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** Opaque random token (refresh / password reset). Only the SHA-256 hash is ever stored. */
function generateOpaqueToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: sha256Hex(token) };
}
const hashToken = sha256Hex;

let jose;
const lib = () => (jose ??= require('jose'));
const keyOf = (secret) => new TextEncoder().encode(secret);

/** Short-lived HS256 access token. `sid` is the refresh-token family id, so the token dies when that session is revoked. */
async function signAccessToken({ userId, familyId }, auth) {
  return new (lib().SignJWT)({ sid: familyId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime(`${auth.accessTokenTtlSeconds}s`)
    .sign(keyOf(auth.accessTokenSecret));
}
/** @returns {Promise<{userId:string, familyId:string}|null>} null for anything invalid/expired (never throws) */
async function verifyAccessToken(token, auth) {
  try {
    const { payload } = await lib().jwtVerify(token, keyOf(auth.accessTokenSecret), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, familyId: payload.sid };
  } catch { return null; }
}

module.exports = { generateOpaqueToken, hashToken, signAccessToken, verifyAccessToken, ISSUER, AUDIENCE };
