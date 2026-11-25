'use strict';
// Real-process startup checks for the ML configuration. Requires Express (the real server.js is started).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express'); // eslint-disable-line no-unused-vars
const { startFakePython, respondJson } = require('../test-support/fakePythonServer');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const within = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out waiting for ${label}`)), ms).unref())]);
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const clean = (extra) => { const env = { ...process.env, ...extra }; for (const k of ['ML_SERVICE_URL', 'ML_SERVICE_TIMEOUT_MS']) if (!(k in extra)) delete env[k]; return env; };
function run(extra) { const child = spawn(process.execPath, [SERVER], { env: clean(extra), stdio: ['ignore', 'pipe', 'pipe'] }); const p = { child, out: '', err: '' }; child.stdout.on('data', (d) => { p.out += d; }); child.stderr.on('data', (d) => { p.err += d; }); p.exited = new Promise((r) => child.once('exit', (c) => r(c))); return p; }
const waitUp = async (url) => { for (let i = 0; i < 60; i++) { try { return await fetch(url); } catch { await new Promise((r) => setTimeout(r, 250)); } } throw new Error('server did not start'); };

describe('server startup validates ML configuration', () => {
  it('production/staging without ML_SERVICE_URL: exits 1 with a clear configuration error (nothing invented, nothing listening)', async () => {
    for (const NODE_ENV of ['production', 'staging']) { const p = run({ NODE_ENV, PORT: String(await freePort()) }); assert.equal(await within(p.exited, 15000, 'exit'), 1); assert.match(p.err, /Configuration error: ML_SERVICE_URL is required/); assert.doesNotMatch(p.out, /listening/); }
  });
  it('invalid ML_SERVICE_URL / timeout: exits 1; the bad URL is never echoed', async () => {
    for (const [extra, pattern] of [[{ ML_SERVICE_URL: 'ftp://secret-host:21' }, /Invalid ML_SERVICE_URL/], [{ ML_SERVICE_URL: 'http://user:pw@host:8000' }, /credentials are not allowed/], [{ ML_SERVICE_TIMEOUT_MS: '5' }, /Invalid ML_SERVICE_TIMEOUT_MS/]]) {
      const p = run({ NODE_ENV: 'test', PORT: String(await freePort()), ...extra }); assert.equal(await within(p.exited, 15000, 'exit'), 1); assert.match(p.err, pattern); assert.doesNotMatch(p.err, /secret-host|pw@/);
    }
  });
  it('starts normally when the Python service is down (no false readiness): /health 200, /ready 503 not_ready', async () => {
    const port = await freePort(); const p = run({ NODE_ENV: 'test', PORT: String(port), ML_SERVICE_URL: `http://127.0.0.1:${await freePort()}` });
    try {
      assert.equal((await waitUp(`http://127.0.0.1:${port}/health`)).status, 200); const r = await fetch(`http://127.0.0.1:${port}/ready`); const body = await r.json();
      assert.equal(r.status, 503); assert.equal(body.checks.mlService.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(body), /127\.0\.0\.1:\d+/); assert.doesNotMatch(p.err, /Error|ECONNREFUSED/);
    } finally { if (p.child.exitCode === null) p.child.kill(); }
  });
  it('production with an explicit URL starts and reaches the (fake) Python service through /ready', async () => {
    const fake = await startFakePython({ health: respondJson(200, { ready: true, model_loaded: true, preprocessor_loaded: true }) }); const port = await freePort(); const p = run({ NODE_ENV: 'production', PORT: String(port), ML_SERVICE_URL: fake.baseUrl });
    try { await waitUp(`http://127.0.0.1:${port}/health`); const r = await fetch(`http://127.0.0.1:${port}/ready`); assert.equal(r.status, 200); assert.equal((await r.json()).status, 'ready'); }
    finally { if (p.child.exitCode === null) p.child.kill(); await fake.close(); }
  });
});
