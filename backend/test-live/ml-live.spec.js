'use strict';
// LIVE tests against the REAL Python ML service. Run deliberately with `npm run test:live` after starting the Python service
// (default http://127.0.0.1:8000, override with ML_SERVICE_URL). Not part of `npm test` (not matched by default discovery).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createMlClient } = require('../src/clients/mlClient');
const { createRecommendationService } = require('../src/services/recommendationService');
const { loadConfig } = require('../src/config/env');

const names = ['golden', 'empty', 'all-excluded', 'zero-time', 'top-k'];
const SC = Object.fromEntries(names.map((n) => [n, require(`../test/fixtures/ml/scenario-${n}.json`)]));
const TOL = 1e-9;

// Deep equality where numbers may differ by TOL (floating point across machines); everything else must match exactly.
function assertClose(actual, expected, where = 'root') {
  if (typeof expected === 'number' && typeof actual === 'number') return assert.ok(Math.abs(actual - expected) <= TOL, `${where}: ${actual} vs ${expected}`);
  if (Array.isArray(expected)) { assert.ok(Array.isArray(actual) && actual.length === expected.length, `${where}: length`); return expected.forEach((e, i) => assertClose(actual[i], e, `${where}[${i}]`)); }
  if (expected && typeof expected === 'object') { assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${where}: keys`); return Object.keys(expected).forEach((k) => assertClose(actual[k], expected[k], `${where}.${k}`)); }
  assert.equal(actual, expected, where);
}

describe('LIVE: real Python ML service', () => {
  const config = loadConfig({ NODE_ENV: 'test', ...(process.env.ML_SERVICE_URL ? { ML_SERVICE_URL: process.env.ML_SERVICE_URL } : {}) });
  const client = createMlClient(config.mlService);
  before(async () => {
    const r = await client.checkReadiness();
    if (r.status !== 'ok') throw new Error(`The Python ML service is not ready (${r.status}${r.reasonCode ? `: ${r.reasonCode}` : ''}). Start it first: cd worktodo_service; .venv\\Scripts\\Activate.ps1; uvicorn app.main:app --host 127.0.0.1 --port 8000`);
  });

  it('readiness reports model and preprocessor loaded', async () => assert.deepEqual(await client.checkReadiness(), { status: 'ok', ready: true, modelLoaded: true, preprocessorLoaded: true }));
  for (const n of names) {
    it(`${n}: real Python response equals the golden engine response (scores within 1e-9)`, async () => assertClose(await client.recommend(SC[n].pythonRequest), SC[n].pythonResponse));
    it(`${n}: service end-to-end equals the expected public response`, async () => assertClose(await createRecommendationService({ mlClient: client }).recommend(SC[n].publicRequest), SC[n].publicResponse));
  }
  it('real Python validation errors are mapped to safe 422s', async () => {
    const service = createRecommendationService({ mlClient: client }); const g = SC.golden.publicRequest;
    const bad = async (tasks, session = g.session) => { try { await service.recommend({ session, tasks }); } catch (e) { assert.equal(e.status, 422); assert.equal(e.code, 'validation_error'); return e.errors; } assert.fail('expected a 422'); };
    assert.deepEqual(await bad([{ ...g.tasks[0], importance: 'Urgent' }]), [{ field: 'importance', message: 'has an invalid value; allowed values: Critical, High, Low, Medium', taskIds: ['T1'] }]);
    assert.equal((await bad([g.tasks[0], g.tasks[0]]))[0].message, 'must be unique');
    assert.equal((await bad([{ ...g.tasks[0], isSplittable: true, estimatedDurationMinutes: 20, minimumSessionMinutes: 30 }]))[0].field, 'minimumSessionMinutes');
    assert.equal((await bad([g.tasks[0]], { ...g.session, availableTimeMinutes: -5 }))[0].field, 'availableTimeMinutes');
    assert.equal((await bad([{ ...g.tasks[0], estimatedDurationMinutes: 0 }]))[0].message, 'must be greater than zero');
  });
  it('Node app over real HTTP -> real Python: golden response and readiness', async () => {
    const { createApp } = require('../src/app'); const server = await new Promise((r) => { const s = createApp(config).listen(0, '127.0.0.1', () => r(s)); }); const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const res = await fetch(`${base}/api/v1/recommendations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(SC.golden.publicRequest) }); assert.equal(res.status, 200); assertClose(await res.json(), SC.golden.publicResponse);
      const ready = await fetch(`${base}/ready`); assert.equal(ready.status, 200); assert.equal((await ready.json()).status, 'ready');
    } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  });
});
