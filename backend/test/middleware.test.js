'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { notFound } = require('../src/middleware/notFound');
const { errorHandler } = require('../src/middleware/errorHandler');
const { loadConfig } = require('../src/config/env');

const fakeRes = (headersSent = false) => ({ headersSent, statusCode: undefined, body: undefined,
  status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const req = { method: 'GET', path: '/x' };
const silent = () => { const logs = []; return { logs, error: (...a) => logs.push(a) }; };
const run = (config, err, res = fakeRes(), logger = silent(), next = () => { throw new Error('next called'); }) => {
  errorHandler(config, logger)(err, req, res, next); return { res, logger };
};
const cfg = (nodeEnv) => loadConfig(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv });
const PROD = cfg('production'), DEV = cfg('development');

describe('notFound', () => {
  it('returns a structured 404', () => {
    const res = fakeRes(); notFound({ method: 'POST', path: '/nope' }, res);
    assert.equal(res.statusCode, 404); assert.deepEqual(res.body, { error: 'not_found', message: 'Route POST /nope not found' });
  });
});

describe('errorHandler', () => {
  it('maps malformed JSON (body-parser) to 400 without echoing the parser message', () => {
    const { res } = run(PROD, Object.assign(new SyntaxError('Unexpected token } in JSON at position 5 secret'), { status: 400, type: 'entity.parse.failed' }));
    assert.equal(res.statusCode, 400); assert.deepEqual(res.body, { error: 'malformed_json', message: 'Request body is not valid JSON' });
  });
  it('maps other body-parser errors', () => {
    assert.equal(run(PROD, { type: 'entity.too.large', status: 413 }).res.body.error, 'payload_too_large');
    assert.equal(run(PROD, { type: 'charset.unsupported', status: 415 }).res.statusCode, 415);
  });
  it('keeps client (4xx) statuses; exposes only safe messages', () => {
    let r = run(PROD, Object.assign(new Error('Bad thing'), { status: 422, expose: true })).res;
    assert.deepEqual([r.statusCode, r.body.error, r.body.message], [422, 'http_error', 'Bad thing']);
    r = run(PROD, Object.assign(new Error('internal path /etc/x'), { statusCode: 403 })).res;
    assert.deepEqual([r.statusCode, r.body.message], [403, 'Forbidden']);
    assert.equal(run(PROD, Object.assign(new Error('x'), { status: 404 })).res.body.error, 'not_found');
  });
  it('production 5xx: generic message, error id, no stack, error logged server-side', () => {
    const { res, logger } = run(PROD, new Error('db password is hunter2'));
    assert.equal(res.statusCode, 500); assert.equal(res.body.error, 'internal_error'); assert.equal(res.body.message, 'Unexpected server error');
    assert.match(res.body.errorId, /^[0-9a-f]{12}$/); assert.equal('stack' in res.body, false);
    assert.ok(!JSON.stringify(res.body).includes('hunter2')); assert.equal(logger.logs.length, 1); assert.ok(logger.logs[0][0].includes(res.body.errorId));
  });
  it('NODE_ENV matrix: ONLY development exposes message/stack; the error is always logged server-side with its stack', () => {
    const secret = new Error('db password is hunter2 at C:\\\\app\\\\secrets.js');
    for (const nodeEnv of ['development', 'production', 'staging', 'test', undefined, 'prod', 'Development', 'DEVELOPMENT', '']) {
      const { res, logger } = run(cfg(nodeEnv), secret); const text = JSON.stringify(res.body); const dev = nodeEnv === 'development', label = String(nodeEnv);
      assert.equal(res.statusCode, 500, label); assert.equal(res.body.error, 'internal_error', label); assert.match(res.body.errorId, /^[0-9a-f]{12}$/, label);
      assert.equal(text.includes('hunter2'), dev, `message exposure for ${label}`); assert.equal('stack' in res.body, dev, `stack exposure for ${label}`);
      if (!dev) { assert.equal(res.body.message, 'Unexpected server error', label); assert.ok(!/secrets\.js|\bat \w/.test(text), `no paths/frames for ${label}`); }
      assert.equal(logger.logs.length, 1, label); assert.equal(logger.logs[0][1], secret, `full error logged for ${label}`);
    }
  });
  it('fail-closed: configs without an explicit exposeErrorDetails:true (including the legacy isProduction:false shape) never leak', () => {
    for (const config of [{}, { isProduction: false }, { exposeErrorDetails: 'true' }, { exposeErrorDetails: 1 }, { exposeErrorDetails: undefined }]) {
      const { res } = run(config, new Error('hunter2')); assert.equal('stack' in res.body, false); assert.ok(!JSON.stringify(res.body).includes('hunter2'));
    }
    assert.equal('stack' in run({ exposeErrorDetails: true }, new Error('x')).res.body, true);
  });
  it('4xx responses are identical in every environment (status codes and bodies unchanged)', () => {
    const mk = () => Object.assign(new Error('Bad thing'), { status: 422, expose: true });
    const bodies = ['development', 'production', 'staging', 'test', undefined, 'prod'].map((e) => { const { res } = run(cfg(e), mk()); return [res.statusCode, JSON.stringify(res.body)]; });
    for (const b of bodies) assert.deepEqual(b, bodies[0]); assert.deepEqual(bodies[0], [422, '{"error":"http_error","message":"Bad thing"}']);
    assert.equal(run(cfg(undefined), { type: 'entity.parse.failed', status: 400 }).res.body.error, 'malformed_json');
  });
  it('development 5xx: includes message and stack', () => {
    const { res } = run(DEV, new Error('boom')); assert.equal(res.body.message, 'boom'); assert.match(res.body.stack, /boom/);
  });
  it('handles non-Error throwables and invalid statuses as 500', () => {
    for (const thrown of ['a string', null, undefined, 42, { status: 'abc' }, { status: 200 }, { status: 99 }]) {
      const { res } = run(PROD, thrown); assert.equal(res.statusCode, 500, String(thrown)); assert.equal(res.body.error, 'internal_error');
    }
  });
  it('delegates to Express default handler when headers were already sent', () => {
    let forwarded; const err = new Error('late'); errorHandler(PROD, silent())(err, req, fakeRes(true), (e) => { forwarded = e; });
    assert.equal(forwarded, err);
  });
  it('has the 4-argument signature Express requires', () => {
    assert.equal(errorHandler(PROD).length, 4);
  });
});
