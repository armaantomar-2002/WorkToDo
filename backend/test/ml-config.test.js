'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, assertMlConfigured, DEFAULT_ML_SERVICE_URL, DEFAULT_ML_TIMEOUT_MS } = require('../src/config/env');

describe('ML service configuration', () => {
  it('defaults (127.0.0.1:8000, 10 s) apply to development, test and unset', () => {
    for (const env of [{ NODE_ENV: 'development' }, { NODE_ENV: 'test' }, {}, { NODE_ENV: 'prod' }]) {
      const c = loadConfig(env); assert.deepEqual({ ...c.mlService }, { baseUrl: 'http://127.0.0.1:8000', timeoutMs: 10000 }); assert.doesNotThrow(() => assertMlConfigured(c));
    }
    assert.equal(DEFAULT_ML_SERVICE_URL, 'http://127.0.0.1:8000'); assert.equal(DEFAULT_ML_TIMEOUT_MS, 10000);
  });
  it('staging/production have no default: loadConfig still works, assertMlConfigured fails clearly, no URL is invented', () => {
    for (const NODE_ENV of ['production', 'staging']) {
      const c = loadConfig({ NODE_ENV }); assert.equal(c.mlService.baseUrl, undefined); assert.deepEqual([...c.warnings], []);
      assert.throws(() => assertMlConfigured(c), /ML_SERVICE_URL is required when NODE_ENV is "production" or "staging"/);
      assert.doesNotThrow(() => assertMlConfigured(loadConfig({ NODE_ENV, ML_SERVICE_URL: 'https://ml.internal.example:9000' })));
    }
  });
  it('normalizes the URL to its origin and accepts http/https with a port', () => {
    assert.equal(loadConfig({ ML_SERVICE_URL: 'http://localhost:8000/' }).mlService.baseUrl, 'http://localhost:8000');
    assert.equal(loadConfig({ ML_SERVICE_URL: ' https://ml.example.com ' }).mlService.baseUrl, 'https://ml.example.com');
  });
  it('rejects invalid URLs without echoing them', () => {
    for (const bad of ['not a url', 'ftp://host:21', 'file:///etc/passwd', 'http://user:secret@host:8000', 'http://host:8000/api', 'http://host:8000/?x=1', 'http://host:8000/#frag', 'javascript:alert(1)']) {
      assert.throws(() => loadConfig({ ML_SERVICE_URL: bad }), (e) => /^Invalid ML_SERVICE_URL/.test(e.message) && !e.message.includes('secret') && !e.message.includes(bad), bad);
    }
  });
  it('validates ML_SERVICE_TIMEOUT_MS (integer 100-120000)', () => {
    assert.equal(loadConfig({ ML_SERVICE_TIMEOUT_MS: '2500' }).mlService.timeoutMs, 2500); assert.equal(loadConfig({ ML_SERVICE_TIMEOUT_MS: ' 100 ' }).mlService.timeoutMs, 100); assert.equal(loadConfig({ ML_SERVICE_TIMEOUT_MS: '120000' }).mlService.timeoutMs, 120000);
    for (const bad of ['99', '120001', '1.5', '-5', 'abc', '1e4', '0']) assert.throws(() => loadConfig({ ML_SERVICE_TIMEOUT_MS: bad }), /Invalid ML_SERVICE_TIMEOUT_MS/, bad);
    assert.equal(loadConfig({ ML_SERVICE_TIMEOUT_MS: '' }).mlService.timeoutMs, 10000);
  });
  it('config stays immutable and Stage 5.1 settings are unaffected', () => {
    const c = loadConfig({ PORT: '6001', NODE_ENV: 'development' }); assert.throws(() => { c.mlService.timeoutMs = 1; }, TypeError);
    assert.deepEqual([c.port, c.exposeErrorDetails, c.nodeEnv], [6001, true, 'development']);
  });
});
