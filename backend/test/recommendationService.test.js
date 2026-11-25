'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMlClient } = require('../src/clients/mlClient');
const { createRecommendationService } = require('../src/services/recommendationService');
const { AppError } = require('../src/errors/AppError');
const { startFakePython, respondJson } = require('../test-support/fakePythonServer');

const names = ['golden', 'empty', 'all-excluded', 'zero-time', 'top-k'];
const SC = Object.fromEntries(names.map((n) => [n, require(`./fixtures/ml/scenario-${n}.json`)]));
const samples422 = require('./fixtures/ml/python-422-samples.json').samples;
const open = [];
const setup = async (recommend) => { const f = await startFakePython({ recommend }); open.push(f); return { f, service: createRecommendationService({ mlClient: createMlClient({ baseUrl: f.baseUrl, timeoutMs: 1000 }) }) }; };
afterEach(async () => { while (open.length) await open.pop().close(); });
const code = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof AppError); return [e.status, e.code]; } assert.fail('expected an AppError'); };

describe('recommendationService (validation -> mapping -> Python -> contract check -> mapping), via a fake Python server', () => {
  for (const n of names) {
    it(`${n}: returns the expected public response and sends exactly the golden Python payload`, async () => {
      const { f, service } = await setup(respondJson(200, SC[n].pythonResponse)); assert.deepEqual(await service.recommend(SC[n].publicRequest), SC[n].publicResponse);
      assert.equal(f.requests.length, 1); assert.deepEqual(f.requests[0].body, SC[n].pythonRequest);
    });
  }
  it('empty task list is still forwarded (Python remains the authority) and returns an empty result', async () => { const { f, service } = await setup(respondJson(200, SC.empty.pythonResponse)); const r = await service.recommend(SC.empty.publicRequest); assert.deepEqual(r.ranked, []); assert.deepEqual(f.requests[0].body.tasks, []); });
  it('invalid requests never reach Python', async () => {
    const { f, service } = await setup(respondJson(200, SC.golden.pythonResponse));
    for (const b of [undefined, {}, { session: {}, tasks: [] }, { ...SC.golden.publicRequest, extra: 1 }, { ...SC.golden.publicRequest, tasks: Array.from({ length: 501 }, (_, i) => ({ ...SC.golden.publicRequest.tasks[0], taskId: `T${i}` })) }]) assert.deepEqual(await code(service.recommend(b)), [422, 'validation_error']);
    assert.equal(f.requests.length, 0);
  });
  it('Python 422 is relayed as a safe 422', async () => { for (const s of samples422.slice(0, 6)) { const { service } = await setup(respondJson(422, s.body)); assert.deepEqual(await code(service.recommend(SC.golden.publicRequest)), [422, 'validation_error']); } });
  it('responses that violate the contract become 502 ml_invalid_response', async () => {
    const mutated = (m) => { const r = JSON.parse(JSON.stringify(SC.golden.pythonResponse)); m(r); return r; };
    for (const m of [(r) => { r.summary.total_tasks = 2; }, (r) => { r.ranked[0].category = 'Maybe'; }, (r) => { delete r.ranked; }, (r) => { r.ranked[0].ml_score = 250; }]) { const { service } = await setup(respondJson(200, mutated(m))); assert.deepEqual(await code(service.recommend(SC.golden.publicRequest)), [502, 'ml_invalid_response']); }
    const { service } = await setup(respondJson(200, SC['top-k'].pythonResponse)); assert.deepEqual(await code(service.recommend({ ...SC['top-k'].publicRequest, topK: 2 })), [502, 'ml_invalid_response']);
  });
  it('upstream failures keep their typed codes', async () => {
    for (const [status, expected] of [[500, [502, 'ml_service_error']], [503, [503, 'ml_service_unavailable']], [400, [502, 'ml_contract_error']]]) { const { service } = await setup(respondJson(status, { error: 'x' })); assert.deepEqual(await code(service.recommend(SC.golden.publicRequest)), expected); }
  });
});
