'use strict';
const { AppError } = require('../errors/AppError');
const { toValidationAppError } = require('../mappers/pythonValidationErrors');

// The ONLY module that talks to the Python ML service. Fixed paths, no redirects, no retries, bounded time and size.

/**
 * Maximum upstream response size: 2 MiB. A 500-task response (the Node task limit) is about 0.3 MB (measured ~0.6 KB/task),
 * so this leaves >6x headroom for longer explanations while bounding memory. Enforced while streaming the body.
 */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_HEALTH_BYTES = 64 * 1024;
const READINESS_TIMEOUT_MS = 2000;

const UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'UND_ERR_DESTROYED']);
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const MESSAGES = {
  ml_service_unavailable: 'The recommendation service is currently unavailable.',
  ml_timeout: 'The recommendation service did not respond in time.',
  ml_service_error: 'The recommendation service encountered an error.',
  ml_contract_error: 'The recommendation service could not process the request.',
  ml_invalid_response: 'The recommendation service returned an invalid response.',
};
const STATUS = { ml_service_unavailable: 503, ml_timeout: 504, ml_service_error: 502, ml_contract_error: 502, ml_invalid_response: 502 };
const fail = (code, logContext, cause) => new AppError({ status: STATUS[code], code, message: MESSAGES[code], logContext, cause });

class ResponseTooLarge extends Error {}

function networkCodes(err) {
  const cause = err && err.cause;
  return [err && err.code, cause && cause.code, ...(cause && Array.isArray(cause.errors) ? cause.errors.map((e) => e && e.code) : [])].filter(Boolean);
}

/** Maps a fetch/stream failure to a typed error. Upstream/system messages are only kept as the (log-only) cause. */
function classify(err) {
  const codes = networkCodes(err);
  if ((err && (err.name === 'TimeoutError' || err.name === 'AbortError')) || codes.some((c) => TIMEOUT_CODES.has(c))) return fail('ml_timeout', { reason: 'timeout' }, err);
  if (codes.some((c) => UNAVAILABLE_CODES.has(c))) return fail('ml_service_unavailable', { reason: codes[0] }, err);
  return fail('ml_service_error', { reason: 'unclassified fetch failure' }, err);
}

/** Reads the body incrementally and aborts as soon as the limit is exceeded (never buffers an unbounded response). */
async function readLimited(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { await res.body?.cancel().catch(() => {}); throw new ResponseTooLarge(); }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new ResponseTooLarge(); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function parseJson(buffer) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); } catch { return undefined; }
}
const safeToken = (v) => (typeof v === 'string' && /^[\w.\-]{1,40}$/.test(v) ? v : undefined);

function createMlClient({ baseUrl, timeoutMs, fetchImpl = globalThis.fetch, maxResponseBytes = MAX_RESPONSE_BYTES }) {
  if (!baseUrl) throw new TypeError('ML service base URL is not configured');

  async function call(path, { method, payload, timeout, maxBytes }) {
    let res;
    try {
      res = await fetchImpl(new URL(path, baseUrl), {
        method, redirect: 'error', signal: AbortSignal.timeout(timeout),
        headers: { accept: 'application/json', ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
      });
    } catch (err) { throw classify(err); }
    let buffer;
    try { buffer = await readLimited(res, maxBytes); } catch (err) {
      throw err instanceof ResponseTooLarge ? fail('ml_invalid_response', { reason: 'response exceeded size limit', limitBytes: maxBytes }) : classify(err);
    }
    return { status: res.status, buffer };
  }

  return {
    /** POST /recommend. Resolves with the parsed (not yet contract-validated) body of a 200; throws AppError otherwise. */
    async recommend(payload) {
      const { status, buffer } = await call('/recommend', { method: 'POST', payload, timeout: timeoutMs, maxBytes: maxResponseBytes });
      const body = parseJson(buffer);
      const logContext = { upstreamStatus: status, upstreamErrorId: safeToken(body && body.error_id), upstreamError: safeToken(body && body.error) };
      if (status === 200) { if (body === undefined) throw fail('ml_invalid_response', { reason: 'body is not valid JSON' }); return body; }
      if (status === 422) throw toValidationAppError(body);
      if (status === 503) throw fail('ml_service_unavailable', logContext);
      if (status >= 500) throw fail('ml_service_error', logContext);
      if (status >= 200 && status < 300) throw fail('ml_invalid_response', { ...logContext, reason: 'unexpected success status' });
      throw fail('ml_contract_error', logContext); // 400, 404, 405 and other 4xx: Node sent something Python does not accept
    },

    /** GET /health -> never throws; a small, URL-free summary for the readiness endpoint. */
    async checkReadiness() {
      let result;
      try { result = await call('/health', { method: 'GET', timeout: Math.min(timeoutMs, READINESS_TIMEOUT_MS), maxBytes: MAX_HEALTH_BYTES }); } catch (err) {
        return { status: err.code === 'ml_timeout' ? 'timeout' : err.code === 'ml_invalid_response' ? 'invalid_response' : 'unavailable' };
      }
      if (result.status >= 500 && result.status !== 503) return { status: 'unavailable' };
      const body = parseJson(result.buffer);
      if (!body || typeof body !== 'object' || typeof body.ready !== 'boolean' || (result.status !== 200 && result.status !== 503)) return { status: 'invalid_response' };
      const flags = { ready: body.ready, modelLoaded: body.model_loaded === true, preprocessorLoaded: body.preprocessor_loaded === true };
      if (result.status === 200 && body.ready) return { status: 'ok', ...flags };
      return { status: 'not_ready', ...flags, ...(safeToken(body.error && body.error.code) ? { reasonCode: body.error.code } : {}) };
    },
  };
}

module.exports = { createMlClient, MAX_RESPONSE_BYTES, MAX_HEALTH_BYTES, READINESS_TIMEOUT_MS };
