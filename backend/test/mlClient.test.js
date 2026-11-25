'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMlClient, MAX_RESPONSE_BYTES } = require('../src/clients/mlClient');
const { AppError } = require('../src/errors/AppError');
const { startFakePython, sendJson, sendRaw, respondJson, hang, freePort } = require('../test-support/fakePythonServer');

const golden = require('./fixtures/ml/scenario-golden.json');
const samples422 = require('./fixtures/ml/python-422-samples.json').samples;
const open = [];
const fake = async (h) => { const f = await startFakePython(h); open.push(f); return f; };
afterEach(async () => { while (open.length) await open.pop().close(); });
const client = (f, o = {}) => createMlClient({ baseUrl: f.baseUrl, timeoutMs: 2000, ...o });
const rejects = async (promise, status, code) => { try { await promise; } catch (e) { assert.ok(e instanceof AppError, `not an AppError: ${e && e.stack}`); assert.equal(e.status, status); assert.equal(e.code, code); return e; } assert.fail(`expected ${code}`); };
const noInternals = (e, f) => { const text = JSON.stringify({ message: e.message, errors: e.errors, code: e.code }); for (const leak of [new URL(f.baseUrl).host, 'ECONNREFUSED', 'Traceback', 'fetch failed', '/srv']) assert.ok(!text.includes(leak), `leaked ${leak}`); };

describe('mlClient.recommend', () => {
  it('POSTs the exact payload to /recommend with JSON headers and returns the parsed body', async () => {
    const f = await fake({ recommend: respondJson(200, golden.pythonResponse) });
    assert.deepEqual(await client(f).recommend(golden.pythonRequest), golden.pythonResponse);
    const r = f.requests[0]; assert.deepEqual([r.method, r.url], ['POST', '/recommend']); assert.deepEqual(r.body, golden.pythonRequest); assert.equal(r.headers['content-type'], 'application/json'); assert.equal(r.headers.accept, 'application/json');
    assert.ok(!('authorization' in r.headers) && !('cookie' in r.headers)); assert.equal(f.requests.length, 1, 'exactly one request (no retries)');
  });
  it('connection refused -> 503 ml_service_unavailable (no URL/system text exposed)', async () => {
    const f = { baseUrl: `http://127.0.0.1:${await freePort()}` }; const e = await rejects(client(f).recommend({}), 503, 'ml_service_unavailable'); noInternals(e, f); assert.equal(e.message, 'The recommendation service is currently unavailable.'); assert.ok(e.cause);
  });
  it('socket reset mid-request -> 503', async () => { const f = await fake({ recommend: (req) => req.socket.destroy() }); noInternals(await rejects(client(f).recommend({}), 503, 'ml_service_unavailable'), f); });
  it('no response within the timeout -> 504 ml_timeout, promptly', async () => {
    const f = await fake({ recommend: hang() }); const t0 = Date.now(); const e = await rejects(client(f, { timeoutMs: 150 }).recommend({}), 504, 'ml_timeout'); assert.ok(Date.now() - t0 < 2000); noInternals(e, f); assert.equal(e.message, 'The recommendation service did not respond in time.');
  });
  it('stalled body after headers -> 504 (timeout covers the body read)', async () => {
    const f = await fake({ recommend: (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"ranked":'); } }); await rejects(client(f, { timeoutMs: 200 }).recommend({}), 504, 'ml_timeout');
  });
  it('HTTP 422 -> 422 validation_error with safe mapped entries (all real samples)', async () => {
    for (const s of samples422) { const f = await fake({ recommend: respondJson(422, s.body) }); const e = await rejects(client(f).recommend({}), 422, 'validation_error'); assert.equal(e.message, 'Request validation failed'); assert.ok(e.errors.length >= 1); noInternals(e, f); await f.close(); open.pop(); }
  });
  it('HTTP 400 / 404 / 405 / other 4xx -> 502 ml_contract_error', async () => {
    for (const status of [400, 401, 404, 405, 409, 413]) { const f = await fake({ recommend: respondJson(status, { error: 'http_error', message: 'Traceback /srv/x.py' }) }); noInternals(await rejects(client(f).recommend({}), 502, 'ml_contract_error'), f); }
  });
  it('HTTP 500 -> 502 ml_service_error; upstream error_id only in the log context', async () => {
    const f = await fake({ recommend: respondJson(500, { error: 'internal_error', message: 'Unexpected server error', error_id: 'abc123def456' }) }); const e = await rejects(client(f).recommend({}), 502, 'ml_service_error');
    assert.equal(e.logContext.upstreamErrorId, 'abc123def456'); assert.equal(e.logContext.upstreamStatus, 500); assert.ok(!e.message.includes('abc123')); noInternals(e, f);
  });
  it('HTTP 500 with HTML/garbage body, and other 5xx -> 502 ml_service_error; error_id with unsafe chars is dropped', async () => {
    for (const status of [500, 502, 504]) { const f = await fake({ recommend: (req, res) => sendRaw(res, status, '<html>Traceback /srv/app</html>', { 'content-type': 'text/html' }) }); noInternals(await rejects(client(f).recommend({}), 502, 'ml_service_error'), f); }
    const g = await fake({ recommend: respondJson(500, { error_id: '../../etc/passwd' }) }); assert.equal((await rejects(client(g).recommend({}), 502, 'ml_service_error')).logContext.upstreamErrorId, undefined);
  });
  it('HTTP 503 -> 503 ml_service_unavailable', async () => { const f = await fake({ recommend: respondJson(503, { error: 'service_unavailable', message: 'Model artifacts are not loaded; see /health' }) }); noInternals(await rejects(client(f).recommend({}), 503, 'ml_service_unavailable'), f); });
  it('200 with invalid JSON / empty body / invalid UTF-8 -> 502 ml_invalid_response', async () => {
    for (const raw of ['{not json', '', '<html></html>', Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d])]) { const f = await fake({ recommend: (req, res) => { res.writeHead(200, { 'content-length': Buffer.byteLength(raw) }); res.end(raw); } }); noInternals(await rejects(client(f).recommend({}), 502, 'ml_invalid_response'), f); }
  });
  it('unexpected success statuses (201/204) -> 502 ml_invalid_response; redirects are never followed', async () => {
    for (const status of [201, 202]) { const f = await fake({ recommend: respondJson(status, golden.pythonResponse) }); await rejects(client(f).recommend({}), 502, 'ml_invalid_response'); }
    const f = await fake({ recommend: (req, res) => { res.writeHead(302, { location: '/health' }); res.end(); } }); await rejects(client(f).recommend({}), 502, 'ml_service_error'); assert.equal(f.requests.length, 1, 'redirect target was not requested');
  });
});

describe('mlClient response size limit (enforced while reading)', () => {
  it('the documented limit is 2 MiB', () => assert.equal(MAX_RESPONSE_BYTES, 2 * 1024 * 1024));
  it('rejects a declared Content-Length above the limit without reading the body', async () => {
    const f = await fake({ recommend: (req, res) => { res.writeHead(200, { 'content-length': 5000 }); res.write('x'.repeat(1000)); } }); const e = await rejects(client(f, { maxResponseBytes: 1000 }).recommend({}), 502, 'ml_invalid_response'); assert.match(e.logContext.reason, /size limit/); noInternals(e, f);
  });
  it('aborts a chunked response with no Content-Length once the limit is crossed, and stops the upstream stream', async () => {
    let sent = 0; let closed; const closedP = new Promise((r) => { closed = r; });
    const f = await fake({ recommend: (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.on('close', closed); const t = setInterval(() => { if (res.destroyed) return clearInterval(t); sent += 1000; res.write('x'.repeat(1000)); if (sent > 2_000_000) { clearInterval(t); res.end(); } }, 2); } });
    await rejects(client(f, { maxResponseBytes: 5000 }).recommend({}), 502, 'ml_invalid_response'); await Promise.race([closedP, new Promise((_, r) => setTimeout(() => r(new Error('upstream not closed')), 3000))]); assert.ok(sent < 200_000, `upstream kept sending: ${sent} bytes`);
  });
  it('with the real 2 MiB limit: just over is rejected, just under is accepted', async () => {
    const mk = (n) => '{"pad":"' + 'a'.repeat(n - 10) + '"}';
    const over = await fake({ recommend: (req, res) => sendRaw(res, 200, mk(MAX_RESPONSE_BYTES + 1), { 'content-type': 'application/json' }) }); await rejects(client(over).recommend({}), 502, 'ml_invalid_response');
    const under = await fake({ recommend: (req, res) => sendRaw(res, 200, mk(MAX_RESPONSE_BYTES - 100), { 'content-type': 'application/json' }) }); assert.equal((await client(under).recommend({})).pad.length, MAX_RESPONSE_BYTES - 110);
    const chunked = await fake({ recommend: (req, res) => { res.writeHead(200); res.write(mk(MAX_RESPONSE_BYTES - 5).slice(0, MAX_RESPONSE_BYTES - 10)); res.write('a'.repeat(100)); res.end('"}'); } }); await rejects(client(chunked).recommend({}), 502, 'ml_invalid_response');
  });
  it('error responses are also size-limited', async () => { const f = await fake({ recommend: (req, res) => sendRaw(res, 500, 'e'.repeat(5000)) }); await rejects(client(f, { maxResponseBytes: 1000 }).recommend({}), 502, 'ml_invalid_response'); });
});

describe('mlClient.checkReadiness (never throws, never leaks URLs)', () => {
  const ready = { status: 'ok', api_running: true, model_loaded: true, preprocessor_loaded: true, config_loaded: true, ready: true, warnings: [], error: null };
  it('ok', async () => { const f = await fake({ health: respondJson(200, ready) }); assert.deepEqual(await client(f).checkReadiness(), { status: 'ok', ready: true, modelLoaded: true, preprocessorLoaded: true }); assert.equal(f.requests[0].method, 'GET'); });
  it('Python 503 not ready -> not_ready with flags and a safe reasonCode (never the message)', async () => {
    const f = await fake({ health: respondJson(503, { ...ready, status: 'unavailable', model_loaded: true, preprocessor_loaded: false, ready: false, error: { code: 'artifact_missing', message: 'Required artifact missing: worktodo_preprocessor.joblib' } }) });
    const r = await client(f).checkReadiness(); assert.deepEqual(r, { status: 'not_ready', ready: false, modelLoaded: true, preprocessorLoaded: false, reasonCode: 'artifact_missing' }); assert.ok(!JSON.stringify(r).includes('joblib'));
  });
  it('200 with ready=false -> not_ready', async () => { const f = await fake({ health: respondJson(200, { ...ready, ready: false }) }); assert.equal((await client(f).checkReadiness()).status, 'not_ready'); });
  it('connection refused -> unavailable; hang -> timeout (bounded by min(timeout, 2 s)); 500 -> unavailable', async () => {
    assert.deepEqual(await createMlClient({ baseUrl: `http://127.0.0.1:${await freePort()}`, timeoutMs: 1000 }).checkReadiness(), { status: 'unavailable' });
    const h = await fake({ health: hang() }); const t0 = Date.now(); assert.deepEqual(await client(h, { timeoutMs: 200 }).checkReadiness(), { status: 'timeout' }); assert.ok(Date.now() - t0 < 1500);
    const s = await fake({ health: respondJson(500, { error: 'internal_error' }) }); assert.deepEqual(await client(s).checkReadiness(), { status: 'unavailable' });
  });
  it('invalid JSON, wrong shape, unexpected status, oversize -> invalid_response', async () => {
    for (const h of [(q, r) => sendRaw(r, 200, 'nope'), respondJson(200, { hello: 1 }), respondJson(200, { ready: 'yes' }), respondJson(404, { error: 'x' }), (q, r) => sendRaw(r, 200, 'x'.repeat(70 * 1024))]) { const f = await fake({ health: h }); assert.equal((await client(f).checkReadiness()).status, 'invalid_response'); }
  });
});

describe('mlClient construction', () => { it('requires a base URL', () => assert.throws(() => createMlClient({ timeoutMs: 1000 }), TypeError)); });
