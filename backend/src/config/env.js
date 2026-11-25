'use strict';
const { version } = require('../../package.json');

const DEFAULT_PORT = 5000;
const KNOWN_ENVS = ['development', 'test', 'staging', 'production'];
const DEFAULT_ML_SERVICE_URL = 'http://127.0.0.1:8000'; // local development default only (see parseMlServiceUrl)
const DEFAULT_ML_TIMEOUT_MS = 10000;

function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const text = String(value).trim(); // tolerate stray spaces, e.g. Windows `set PORT=5000 && ...`
  const port = Number(text);
  if (!/^\d+$/.test(text) || port > 65535) {
    throw new Error(`Invalid PORT "${value}": must be an integer between 0 and 65535`);
  }
  return port;
}

/** ML service base URL. Defaults only for development/test/unset; staging/production must set it explicitly (see assertMlConfigured). */
function parseMlServiceUrl(value, nodeEnv) {
  const text = String(value ?? '').trim();
  if (!text) return nodeEnv === 'production' || nodeEnv === 'staging' ? undefined : DEFAULT_ML_SERVICE_URL;
  let url;
  try { url = new URL(text); } catch { throw new Error('Invalid ML_SERVICE_URL: must be an absolute http(s) URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid ML_SERVICE_URL: protocol must be http or https');
  if (url.username || url.password) throw new Error('Invalid ML_SERVICE_URL: credentials are not allowed');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid ML_SERVICE_URL: must not include a path, query or hash');
  return url.origin;
}

function parseMlTimeoutMs(value) {
  const text = String(value ?? '').trim();
  if (!text) return DEFAULT_ML_TIMEOUT_MS;
  const ms = Number(text);
  if (!/^\d+$/.test(text) || ms < 100 || ms > 120000) throw new Error(`Invalid ML_SERVICE_TIMEOUT_MS "${value}": must be an integer between 100 and 120000`);
  return ms;
}


// ---- Full-stack additions (database, auth, CORS, email). All optional unless DATABASE_URL is set. ----
function parseIntRange(value, name, def, min, max) {
  const text = String(value ?? '').trim();
  if (!text) return def;
  const n = Number(text);
  if (!/^\d+$/.test(text) || n < min || n > max) throw new Error(`Invalid ${name} "${value}": must be an integer between ${min} and ${max}`);
  return n;
}

function parseDatabaseUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  let url;
  try { url = new URL(text); } catch { throw new Error('Invalid DATABASE_URL: must be a postgresql:// connection URL'); }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('Invalid DATABASE_URL: protocol must be postgresql');
  return text;
}

function parseOrigins(value, nodeEnv) {
  const text = String(value ?? '').trim();
  if (!text) return nodeEnv === 'production' || nodeEnv === 'staging' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  return text.split(',').map((o) => o.trim()).filter(Boolean).map((o) => {
    let url;
    try { url = new URL(o); } catch { throw new Error(`Invalid FRONTEND_ORIGIN entry "${o}": must be an origin like http://localhost:5173`); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Invalid FRONTEND_ORIGIN entry "${o}": protocol must be http or https`);
    return url.origin;
  });
}

function parseBool(value, def) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return def;
  if (['true', '1', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  throw new Error(`Invalid boolean "${value}": use true or false`);
}

function parseEmailProvider(value) {
  const text = String(value ?? '').trim().toLowerCase() || 'console';
  if (!['console', 'none'].includes(text)) throw new Error('Invalid EMAIL_PROVIDER: supported values are "console" (development only, prints to the server log) and "none"');
  return text;
}

/** Throws when DATABASE_URL is set but auth/CORS settings required to run the authenticated API are missing or unsafe. */
function assertDatabaseConfigured(config) {
  if (!config.database.url) return;
  const secret = config.auth.accessTokenSecret;
  if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET is required (at least 32 characters) when DATABASE_URL is set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
  if (config.cors.allowedOrigins.length === 0) throw new Error('FRONTEND_ORIGIN is required when NODE_ENV is "production" or "staging" and DATABASE_URL is set');
  if (config.isProduction && !config.cookies.secure) throw new Error('COOKIE_SECURE must not be false in production');
}

/** Throws when the ML service URL is required (staging/production) but missing. Called at startup by server.js. */
function assertMlConfigured(config) {
  if (!config.mlService.baseUrl) throw new Error('ML_SERVICE_URL is required when NODE_ENV is "production" or "staging"');
}

/** Reads configuration from an environment object (defaults to process.env). Throws on invalid values. */
function loadConfig(env = process.env) {
  // Trim: Windows `set NODE_ENV=development && ...` leaves a trailing space. Matching stays exact and case-sensitive.
  const rawEnv = String(env.NODE_ENV ?? '').trim();
  const nodeEnv = rawEnv || 'unset';
  const warnings = [];
  if (!rawEnv) {
    warnings.push('NODE_ENV is not set; treated as non-development (detailed error responses are disabled). Set NODE_ENV=development for local debugging.');
  } else if (!KNOWN_ENVS.includes(rawEnv)) {
    warnings.push(`Unrecognized NODE_ENV "${rawEnv}"; treated as non-development (detailed error responses are disabled). Supported values: ${KNOWN_ENVS.join(', ')}.`);
  }
  return Object.freeze({
    service: 'worktodo-backend',
    name: 'WorkToDo Backend',
    version,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    // Fail-closed: ONLY NODE_ENV=development exposes error details (messages/stacks) to clients.
    exposeErrorDetails: nodeEnv === 'development',
    warnings: Object.freeze(warnings),
    port: parsePort(env.PORT),
    host: env.HOST || undefined,
    mlService: Object.freeze({ baseUrl: parseMlServiceUrl(env.ML_SERVICE_URL, nodeEnv), timeoutMs: parseMlTimeoutMs(env.ML_SERVICE_TIMEOUT_MS) }),
    database: Object.freeze({ url: parseDatabaseUrl(env.DATABASE_URL) }),
    auth: Object.freeze({
      accessTokenSecret: String(env.JWT_ACCESS_SECRET ?? '').trim() || undefined,
      accessTokenTtlSeconds: parseIntRange(env.ACCESS_TOKEN_TTL_SECONDS, 'ACCESS_TOKEN_TTL_SECONDS', 900, 60, 3600),
      refreshTokenTtlDays: parseIntRange(env.REFRESH_TOKEN_TTL_DAYS, 'REFRESH_TOKEN_TTL_DAYS', 7, 1, 90),
      rememberMeTtlDays: parseIntRange(env.REMEMBER_ME_TTL_DAYS, 'REMEMBER_ME_TTL_DAYS', 30, 1, 365),
      passwordResetTtlMinutes: parseIntRange(env.PASSWORD_RESET_TTL_MINUTES, 'PASSWORD_RESET_TTL_MINUTES', 30, 5, 1440),
      rateLimitWindowMs: parseIntRange(env.AUTH_RATE_LIMIT_WINDOW_MS, 'AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, 1000, 24 * 3600 * 1000),
      rateLimitMax: parseIntRange(env.AUTH_RATE_LIMIT_MAX, 'AUTH_RATE_LIMIT_MAX', 20, 1, 10000),
    }),
    cookies: Object.freeze({
      secure: parseBool(env.COOKIE_SECURE, nodeEnv === 'production' || nodeEnv === 'staging'),
      name: 'wt_refresh',
      path: '/api/v1/auth',
    }),
    cors: Object.freeze({ allowedOrigins: Object.freeze(parseOrigins(env.FRONTEND_ORIGIN, nodeEnv)) }),
    trustProxy: parseBool(env.TRUST_PROXY, false),
    email: Object.freeze({ provider: parseEmailProvider(env.EMAIL_PROVIDER), appUrl: String(env.APP_URL ?? '').trim() || 'http://localhost:5173' }),
    features: Object.freeze({
      // Stateless POST /api/v1/recommendations (no auth, no persistence): off by default in production when a database is configured.
      statelessRecommendations: parseBool(env.ENABLE_STATELESS_RECOMMENDATIONS, !(nodeEnv === 'production' && Boolean(parseDatabaseUrl(env.DATABASE_URL)))),
    }),
  });
}

module.exports = { loadConfig, assertMlConfigured, assertDatabaseConfigured, DEFAULT_PORT, KNOWN_ENVS, DEFAULT_ML_SERVICE_URL, DEFAULT_ML_TIMEOUT_MS };
