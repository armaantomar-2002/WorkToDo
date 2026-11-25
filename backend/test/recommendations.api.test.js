'use strict';
// Real Express 5 + real HTTP + fake Python server. Requires Express (a missing install must FAIL, never skip).
const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express'); // eslint-disable-line no-unused-vars
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config/env');
const { startFakePython, sendJson, sendRaw, respondJson, hang, freePort } = require('../test-support/fakePythonServer');

const names = ['golden', 'empty', 'all-excluded', 'zero-time', 'top-k'];
const SC = Object.fromEntries(names.map((n) => [n, require(`./fixtures/ml/scenario-${n}.json`)]));
const samples422 = require('./fixtures/ml/python-422-samples.json').samples;
const ready = { status: 'ok', api_running: true, model_loaded: true, preprocessor_loaded: true, config_loaded: true, ready: true, warnings: [], error: null };

const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;
const close = (s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); });
const post = (base, body, headers = { 'content-type': 'application/json' }) => fetch(`${base}/api/v1/recommendations`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const read = async (res) => ({ status: res.status, type: res.headers.get('content-type'), body: await res.json() });

const open = [];
async function boot({ recommend, health, nodeEnv = 'test', mlUrl, timeoutMs = '5000' }) {
  const fake = await startFakePython({ recommend, health }); open.push(() => fake.close());
  const config = loadConfig({ NODE_ENV: nodeEnv, ML_SERVICE_URL: mlUrl || fake.baseUrl, ML_SERVICE_TIMEOUT_MS: timeoutMs });
  const server = await listen(createApp(config)); open.push(() => close(server));
  return { fake, base: urlOf(server), internalHost: new URL(mlUrl || fake.baseUrl).host };
}
afterEach(async () => { while (open.length) await open.pop()(); });
const noLeak = (text, host) => { for (const leak of [host, 'ECONNREFUSED', 'Traceback', 'fetch failed', '/srv/', 'worktodo_service', '.joblib', '"stack"']) assert.ok(!text.includes(leak), `leaked ${leak}: ${text}`); };

describe('POST /api/v1/recommendations - golden contract over real HTTP', () => {
  for (const n of names) {
    it(`${n}: 200 with the expected public response; Python received exactly the golden payload`, async () => {
      const { base, fake } = await boot({ recommend: respondJson(200, SC[n].pythonResponse) }); const r = await read(await post(base, SC[n].publicRequest));
      assert.equal(r.status, 200); assert.match(r.type, /application\/json/); assert.deepEqual(r.body, SC[n].publicResponse);
      assert.equal(fake.requests.length, 1); assert.deepEqual(fake.requests[0].body, SC[n].pythonRequest);
    });
  }
  it('empty task list, all-excluded and zero-available-time are valid, ordinary 200 responses', async () => {
    for (const n of ['empty', 'all-excluded', 'zero-time']) { const { base } = await boot({ recommend: respondJson(200, SC[n].pythonResponse) }); assert.equal((await post(base, SC[n].publicRequest)).status, 200); }
    assert.equal(SC['zero-time'].publicResponse.summary.startableNow, 0);
  });
  it('exactly 500 tasks is accepted (Python is called once)', async () => {
    const t = SC.golden.publicRequest.tasks[0]; const tasks = Array.from({ length: 500 }, (_, i) => ({ ...t, taskId: `T${i}` }));
    const response = { ranked: [], excluded: tasks.map((x) => ({ task_id: x.taskId, exclusion_reason: 'Task not active' })), summary: { total_tasks: 500, eligible: 0, excluded: 500, returned: 0, startable_now: 0 } };
    const { base, fake } = await boot({ recommend: respondJson(200, response) }); const r = await read(await post(base, { session: SC.golden.publicRequest.session, tasks })); assert.equal(r.status, 200); assert.equal(fake.requests[0].body.tasks.length, 500);
  });
});

describe('POST /api/v1/recommendations - request validation at the Node boundary', () => {
  it('invalid requests get 422 with structured field errors and never reach Python', async () => {
    const { base, fake } = await boot({ recommend: respondJson(200, SC.golden.pythonResponse) }); const g = SC.golden.publicRequest; const t = g.tasks[0];
    const cases = { 'unknown top-level': { ...g, extra: 1 }, 'unknown task key': { ...g, tasks: [{ ...t, dueDat: 'x' }] }, 'missing session': { tasks: [] }, 'missing tasks': { session: g.session }, 'wrong type': { ...g, tasks: [{ ...t, estimatedDurationMinutes: '30' }] },
      'Z-suffixed localTime': { ...g, session: { ...g.session, localTime: '2026-11-16T10:00:00Z' } }, 'offset dueDate': { ...g, tasks: [{ ...t, dueDate: '2026-11-20T10:00:00+05:30' }] }, 'too many tasks': { ...g, tasks: Array.from({ length: 501 }, (_, i) => ({ ...t, taskId: `T${i}` })) }, 'bad topK': { ...g, topK: 0 }, 'array body': [] };
    for (const [label, body] of Object.entries(cases)) { const r = await read(await post(base, body)); assert.equal(r.status, 422, label); assert.equal(r.body.error, 'validation_error', label); assert.ok(r.body.errors.length >= 1 && r.body.errors.every((e) => 'message' in e && 'field' in e), label); }
    assert.equal(fake.requests.length, 0);
  });
  it('malformed JSON -> 400, oversize -> 413, non-JSON content-type -> 422 (no body parsed)', async () => {
    const { base, fake } = await boot({ recommend: respondJson(200, SC.golden.pythonResponse) });
    assert.deepEqual([(await read(await post(base, '{"session":'))).status, (await read(await post(base, '{"session":'))).body.error], [400, 'malformed_json']);
    const big = await read(await post(base, `{"x":"${'a'.repeat(2 * 1024 * 1024)}"}`)); assert.deepEqual([big.status, big.body.error], [413, 'payload_too_large']);
    const text = await read(await post(base, 'hello', { 'content-type': 'text/plain' })); assert.equal(text.status, 422); assert.equal(fake.requests.length, 0);
  });
  it('Python 422 is relayed as a safe 422 (names in camelCase, no upstream text)', async () => {
    const s = samples422.find((x) => x.label === 'splittable min > duration'); const { base } = await boot({ recommend: respondJson(422, s.body) });
    const r = await read(await post(base, SC.golden.publicRequest)); assert.equal(r.status, 422); assert.deepEqual(r.body, { error: 'validation_error', message: 'Request validation failed', errors: [{ field: 'minimumSessionMinutes', message: 'must not exceed estimatedDurationMinutes for splittable tasks', taskIds: ['A'] }] });
  });
  it('only POST is routed', async () => { const { base } = await boot({ recommend: respondJson(200, SC.golden.pythonResponse) }); for (const m of ['GET', 'PUT', 'DELETE']) assert.equal((await fetch(`${base}/api/v1/recommendations`, { method: m })).status, 404); });
});

describe('POST /api/v1/recommendations - upstream failure matrix (identical in every NODE_ENV, nothing internal leaks)', () => {
  const upstream = [
    ['Python 400', respondJson(400, { error: 'malformed_json', message: 'x' }), 502, 'ml_contract_error'], ['Python 404', respondJson(404, { error: 'http_error' }), 502, 'ml_contract_error'],
    ['Python 500', respondJson(500, { error: 'internal_error', message: 'Traceback /srv/x', error_id: 'abc123abc123' }), 502, 'ml_service_error'], ['Python 503', respondJson(503, { error: 'service_unavailable', message: 'artifacts missing /srv/a.joblib' }), 503, 'ml_service_unavailable'],
    ['invalid JSON', (q, r) => sendRaw(r, 200, '{oops'), 502, 'ml_invalid_response'], ['wrong structure', respondJson(200, { hello: 'world' }), 502, 'ml_invalid_response'],
    ['contract violation', respondJson(200, { ...SC.golden.pythonResponse, summary: { ...SC.golden.pythonResponse.summary, total_tasks: 99 } }), 502, 'ml_invalid_response'],
    ['oversize (>2 MiB)', (q, r) => sendRaw(r, 200, `{"p":"${'a'.repeat(2 * 1024 * 1024 + 10)}"}`, { 'content-type': 'application/json' }), 502, 'ml_invalid_response'], ['timeout', hang(), 504, 'ml_timeout'], ['connection reset', (req) => req.socket.destroy(), 503, 'ml_service_unavailable']];
  for (const nodeEnv of ['development', 'production', undefined]) {
    for (const [label, handler, status, code] of upstream) {
      it(`${label} -> ${status} ${code} [NODE_ENV ${nodeEnv}]`, async () => {
        const { base, internalHost } = await boot({ recommend: handler, nodeEnv, timeoutMs: label === 'timeout' ? '300' : undefined }); const res = await post(base, SC.golden.publicRequest); const text = await res.text(); const body = JSON.parse(text);
        assert.equal(res.status, status); assert.equal(body.error, code); assert.equal(body.message.endsWith('.'), true); assert.deepEqual(Object.keys(body).sort(), ['error', 'errorId', 'message']); assert.match(body.errorId, /^[0-9a-f]{12}$/); noLeak(text, internalHost);
      });
    }
    it(`connection refused -> 503 ml_service_unavailable [NODE_ENV ${nodeEnv}]`, async () => {
      const mlUrl = `http://127.0.0.1:${await freePort()}`; const { base, internalHost } = await boot({ mlUrl, nodeEnv }); const res = await post(base, SC.golden.publicRequest); const text = await res.text(); assert.equal(res.status, 503); assert.equal(JSON.parse(text).error, 'ml_service_unavailable'); noLeak(text, internalHost);
    });
  }
  it('a failed upstream call is made exactly once (no retries)', async () => { const { base, fake } = await boot({ recommend: respondJson(503, { error: 'service_unavailable' }) }); await post(base, SC.golden.publicRequest); assert.equal(fake.requests.length, 1); });
});

describe('GET /ready (readiness) is separate from GET /health (liveness)', () => {
  it('ready: 200 when Python reports ready; exactly one upstream probe per call', async () => {
    const { base, fake } = await boot({ health: respondJson(200, ready) }); const r = await read(await fetch(`${base}/ready`));
    assert.equal(r.status, 200); assert.equal(r.body.status, 'ready'); assert.equal(r.body.service, 'worktodo-backend'); assert.deepEqual(r.body.checks, { node: { status: 'ok' }, mlService: { status: 'ok', ready: true, modelLoaded: true, preprocessorLoaded: true } }); assert.equal(fake.requests.length, 1); assert.equal(fake.requests[0].url, '/health');
  });
  it('not ready / unavailable / timeout / invalid -> 503 with a safe status and no internals', async () => {
    const cases = [[respondJson(503, { ...ready, status: 'unavailable', model_loaded: false, preprocessor_loaded: false, ready: false, error: { code: 'artifact_missing', message: 'Required artifact missing: /srv/model.joblib' } }), 'not_ready'], [hang(), 'timeout'], [(q, r) => sendRaw(r, 200, 'nope'), 'invalid_response'], [respondJson(500, {}), 'unavailable']];
    for (const [health, status] of cases) { const { base, internalHost } = await boot({ health, timeoutMs: '300' }); const res = await fetch(`${base}/ready`); const text = await res.text(); const body = JSON.parse(text); assert.equal(res.status, 503); assert.equal(body.status, 'not_ready'); assert.equal(body.checks.mlService.status, status); noLeak(text, internalHost); }
    const { base, internalHost } = await boot({ mlUrl: `http://127.0.0.1:${await freePort()}` }); const res = await fetch(`${base}/ready`); const text = await res.text(); assert.equal(res.status, 503); assert.equal(JSON.parse(text).checks.mlService.status, 'unavailable'); noLeak(text, internalHost);
  });
  it('/health and / stay independent of Python: 200 even when Python is down, never probe it, never claim it is healthy', async () => {
    const { base, fake } = await boot({ mlUrl: `http://127.0.0.1:${await freePort()}` }); const h = await read(await fetch(`${base}/health`)); const root = await read(await fetch(`${base}/`));
    assert.equal(h.status, 200); assert.equal(h.body.status, 'ok'); assert.deepEqual(h.body.dependencies, { mlService: { status: 'not_checked' }, database: { status: 'not_configured' } }); assert.equal(root.body.message, 'WorkToDo backend is running'); assert.equal(fake.requests.length, 0);
  });
  it('/health does not call Python even when it is up', async () => { const { base, fake } = await boot({ health: respondJson(200, ready) }); await fetch(`${base}/health`); assert.equal(fake.requests.length, 0); });
});

describe('createApp dependency injection', () => {
  it('accepts an injected mlClient (no network) and keeps working without one', async () => {
    const calls = []; const mlClient = { recommend: async (p) => { calls.push(p); return SC.golden.pythonResponse; }, checkReadiness: async () => ({ status: 'ok', ready: true, modelLoaded: true, preprocessorLoaded: true }) };
    const server = await listen(createApp(loadConfig({ NODE_ENV: 'test' }), { mlClient })); open.push(() => close(server)); const r = await read(await post(urlOf(server), SC.golden.publicRequest)); assert.deepEqual(r.body, SC.golden.publicResponse); assert.deepEqual(calls[0], SC.golden.pythonRequest);
    const plain = await listen(createApp(loadConfig({ NODE_ENV: 'test' }))); open.push(() => close(plain)); assert.equal((await fetch(`${urlOf(plain)}/health`)).status, 200);
  });
});
