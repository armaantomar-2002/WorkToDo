'use strict';
// Minimal cookie helpers (no dependency). The refresh token cookie is HttpOnly, SameSite=Strict and scoped to /api/v1/auth.

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || Object.hasOwn(out, name)) continue;
    try { out[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed value */ }
  }
  return out;
}

function serializeRefreshCookie(cookies, value, maxAgeSeconds) {
  const attrs = [`${cookies.name}=${encodeURIComponent(value)}`, `Path=${cookies.path}`, 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`];
  if (cookies.secure) attrs.push('Secure');
  if (maxAgeSeconds <= 0) attrs.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return attrs.join('; ');
}

const setRefreshCookie = (res, cookies, token, maxAgeSeconds) => res.append('Set-Cookie', serializeRefreshCookie(cookies, token, maxAgeSeconds));
const clearRefreshCookie = (res, cookies) => res.append('Set-Cookie', serializeRefreshCookie(cookies, '', 0));
const readRefreshCookie = (req, cookies) => parseCookies(req.headers.cookie)[cookies.name];

module.exports = { parseCookies, serializeRefreshCookie, setRefreshCookie, clearRefreshCookie, readRefreshCookie };
