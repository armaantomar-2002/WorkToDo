'use strict';
const { AppError } = require('../errors/AppError');

const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'WorkToDo';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Manual CORS allow-list: only configured frontend origins receive credentialed access. No wildcard. */
function cors(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
    }
    res.append('Vary', 'Origin');
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      if (origin && allowed.has(origin)) {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      return res.status(204).end();
    }
    return next();
  };
}

/**
 * CSRF defence for cookie-authenticated endpoints: SameSite=Strict cookie + Origin allow-list (when the browser sends an
 * Origin) + a custom header that cross-site forms cannot set and that forces a CORS pre-flight for cross-site scripts.
 */
function csrfGuard(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return function csrfMiddleware(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) return next(new AppError({ status: 403, code: 'forbidden_origin', message: 'Request origin is not allowed' }));
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) return next(new AppError({ status: 403, code: 'csrf_header_missing', message: 'Missing required request header' }));
    return next();
  };
}

/** Standard security headers for API responses (JSON only). */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
}

module.exports = { cors, csrfGuard, securityHeaders, CSRF_HEADER, CSRF_VALUE };
