'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, KNOWN_ENVS } = require('../src/config/env');

describe('loadConfig', () => {
  it('uses defaults (port 5000, development)', () => {
    const c = loadConfig({});
    assert.equal(c.port, 5000); assert.equal(c.nodeEnv, 'unset'); assert.equal(c.isProduction, false); assert.equal(c.exposeErrorDetails, false);
    assert.equal(c.host, undefined); assert.equal(c.service, 'worktodo-backend'); assert.match(c.version, /^\d+\.\d+\.\d+/);
  });
  it('reads PORT, NODE_ENV and HOST', () => {
    const c = loadConfig({ PORT: '6001', NODE_ENV: 'production', HOST: '127.0.0.1' });
    assert.deepEqual([c.port, c.isProduction, c.host], [6001, true, '127.0.0.1']);
  });
  it('treats an empty PORT as unset and accepts 0', () => {
    assert.equal(loadConfig({ PORT: '' }).port, 5000); assert.equal(loadConfig({ PORT: '0' }).port, 0);
  });
  it('rejects invalid PORT values with a clear message', () => {
    for (const bad of ['abc', '-1', '70000', '5000.5', ' ', 'NaN', '1e3', '0x10']) {
      assert.throws(() => loadConfig({ PORT: bad }), /Invalid PORT/, `PORT=${bad}`);
    }
  });
  it('exposes error details ONLY when NODE_ENV is exactly "development"', () => {
    const cases = { development: true, production: false, staging: false, test: false, prod: false, Development: false, DEVELOPMENT: false, dev: false, '': false, ' ': false, unset: false, undefined: false };
    for (const [value, expected] of Object.entries(cases)) {
      const env = value === 'undefined' ? {} : { NODE_ENV: value };
      assert.equal(loadConfig(env).exposeErrorDetails, expected, `NODE_ENV=${JSON.stringify(value)}`);
    }
    assert.equal(loadConfig({ NODE_ENV: undefined }).exposeErrorDetails, false);
  });
  it('tolerates whitespace around NODE_ENV (Windows `set X=y && ...`) but stays exact and case-sensitive', () => {
    assert.equal(loadConfig({ NODE_ENV: 'development ' }).exposeErrorDetails, true); assert.equal(loadConfig({ NODE_ENV: ' production ' }).nodeEnv, 'production');
    assert.equal(loadConfig({ NODE_ENV: 'Development' }).exposeErrorDetails, false);
  });
  it('accepts every NODE_ENV value (no breaking startup rejection) and warns only for unset/unrecognized ones', () => {
    for (const v of KNOWN_ENVS) { const c = loadConfig({ NODE_ENV: v }); assert.deepEqual([...c.warnings], [], v); assert.equal(c.nodeEnv, v); }
    assert.match(loadConfig({}).warnings[0], /NODE_ENV is not set/); assert.equal(loadConfig({}).nodeEnv, 'unset');
    const u = loadConfig({ NODE_ENV: 'prod' }); assert.equal(u.nodeEnv, 'prod'); assert.match(u.warnings[0], /Unrecognized NODE_ENV "prod".*development, test, staging, production/);
  });
  it('tolerates surrounding whitespace in a valid PORT', () => { assert.equal(loadConfig({ PORT: ' 5000 ' }).port, 5000); });
  it('returns an immutable object', () => {
    assert.throws(() => { 'use strict'; loadConfig({}).port = 1; }, TypeError);
  });
});
