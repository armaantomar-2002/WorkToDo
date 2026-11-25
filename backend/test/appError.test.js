'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { AppError } = require('../src/errors/AppError');
const { errorHandler } = require('../src/middleware/errorHandler');
const { loadConfig } = require('../src/config/env');

const fakeRes = () => ({ headersSent: false, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const req = { method: 'POST', path: '/api/v1/recommendations' };
const handle = (config, err) => { const logs = []; const res = fakeRes(); errorHandler(config, { error: (...a) => logs.push(a) })(err, req, res, () => { throw new Error('next called'); }); return { res, logs }; };
const ENVS = ['development', 'production', 'staging', 'test', undefined, 'prod'];
const cfg = (e) => loadConfig(e === undefined ? {} : { NODE_ENV: e });

describe('AppError handling', () => {
  it('5xx AppError: fixed message + code + errorId in EVERY environment; cause/logContext only in the log', () => {
    for (const env of ENVS) {
      const cause = new Error('connect ECONNREFUSED 127.0.0.1:8000 at /srv/internal/path.js:10');
      const { res, logs } = handle(cfg(env), new AppError({ status: 503, code: 'ml_service_unavailable', message: 'The recommendation service is currently unavailable.', logContext: { upstreamStatus: 503 }, cause }));
      const text = JSON.stringify(res.body);
      assert.equal(res.statusCode, 503, String(env)); assert.deepEqual(Object.keys(res.body).sort(), ['error', 'errorId', 'message'], String(env));
      assert.equal(res.body.error, 'ml_service_unavailable'); assert.match(res.body.errorId, /^[0-9a-f]{12}$/);
      for (const leak of ['127.0.0.1', 'ECONNREFUSED', '/srv/internal', 'upstreamStatus', 'stack']) assert.ok(!text.includes(leak), `${leak} leaked in ${env}`);
      assert.equal(logs.length, 1); assert.ok(logs[0][0].includes(res.body.errorId) && logs[0][0].includes('ml_service_unavailable')); assert.deepEqual(logs[0][1], { upstreamStatus: 503 }); assert.equal(logs[0][2], cause);
    }
  });
  it('4xx AppError: status, code, message and errors array; no errorId; not logged as an error', () => {
    const errors = [{ field: 'tasks[0].importance', message: 'is required' }];
    const { res, logs } = handle(cfg('production'), new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors }));
    assert.deepEqual([res.statusCode, res.body], [422, { error: 'validation_error', message: 'Request validation failed', errors }]); assert.equal(logs.length, 0);
  });
  it('invalid statuses fall back to 500', () => {
    for (const status of [undefined, 200, 99, 'x', 700]) assert.equal(new AppError({ status, code: 'x', message: 'm' }).status, 500);
  });
  it('only real AppError instances are honored: lookalikes and system errors stay generic 500s', () => {
    for (const env of ENVS) {
      for (const err of [Object.assign(new Error('boom'), { code: 'ml_timeout', status: 504 }), Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }), { name: 'AppError', status: 422, code: 'validation_error', message: 'x' }]) {
        const { res } = handle(cfg(env), err); assert.equal(res.body.error === 'ml_timeout' || res.body.error === 'validation_error', false);
        assert.notEqual(res.body.errorId === undefined && res.statusCode === 504, true); // a lookalike can never produce a 504 ml_timeout response
      }
    }
    const { res } = handle(cfg('production'), Object.assign(new Error('boom'), { code: 'ml_timeout' })); assert.equal(res.statusCode, 500); assert.equal(res.body.error, 'internal_error');
  });
  it('existing fail-closed behavior for generic errors is unchanged', () => {
    const dev = handle(cfg('development'), new Error('secret')).res.body, prod = handle(cfg('production'), new Error('secret')).res.body;
    assert.equal(dev.message, 'secret'); assert.ok(dev.stack); assert.equal(prod.message, 'Unexpected server error'); assert.equal('stack' in prod, false);
  });
});
