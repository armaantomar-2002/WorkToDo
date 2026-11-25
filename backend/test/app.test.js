'use strict';
// Integration tests over real HTTP (Node built-in fetch). Express is mandatory: if it is missing or broken this file fails (never skips).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

const express = require('express');
const { loadConfig } = require('../src/config/env');

const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;
const close = (s) => new Promise((r) => s.close(r));
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const json = async (res) => ({ status: res.status, type: res.headers.get('content-type'), body: await res.json() });
const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const within = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms).unref())]);

describe('GET / and GET /health (real app)', () => {
  let server, base;
  before(async () => { const { createApp } = require('../src/app'); const { loadConfig } = require('../src/config/env'); server = await listen(createApp(loadConfig({ NODE_ENV: 'test' }))); base = urlOf(server); });
  after(() => close(server));

  it('GET / identifies the service', async () => {
    const r = await json(await fetch(`${base}/`));
    assert.equal(r.status, 200); assert.match(r.type, /application\/json/);
    assert.deepEqual([r.body.service, r.body.message, r.body.environment], ['worktodo-backend', 'WorkToDo backend is running', 'test']);
  });
  it('GET /health is structured and does not claim the ML service is healthy', async () => {
    const r = await json(await fetch(`${base}/health`));
    assert.equal(r.status, 200); assert.equal(r.body.status, 'ok'); assert.equal(r.body.service, 'worktodo-backend');
    assert.equal(typeof r.body.uptimeSeconds, 'number'); assert.ok(!Number.isNaN(Date.parse(r.body.timestamp)));
    assert.equal(r.body.dependencies.mlService.status, 'not_checked'); assert.equal(r.body.dependencies.database.status, 'not_configured');
  });
  it('does not advertise Express', async () => { assert.equal((await fetch(`${base}/`)).headers.get('x-powered-by'), null); });
  it('unknown routes return structured 404 for any method', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const r = await json(await fetch(`${base}/does-not-exist`, { method })); assert.equal(r.status, 404); assert.match(r.type, /json/);
      assert.deepEqual(r.body, { error: 'not_found', message: `Route ${method} /does-not-exist not found` });
    }
  });
  it('known path with unsupported method is a 404 JSON (no route registered)', async () => {
    const r = await json(await fetch(`${base}/health`, { method: 'POST' })); assert.equal(r.status, 404);
  });
  it('JSON parsing is active: malformed JSON -> 400, valid JSON passes parsing (reaches 404), oversize -> 413', async () => {
    const post = (body, type = 'application/json') => fetch(`${base}/anything`, { method: 'POST', headers: { 'Content-Type': type }, body });
    let r = await json(await post('{"a": ')); assert.deepEqual([r.status, r.body.error], [400, 'malformed_json']);
    r = await json(await post('{"a": 1}')); assert.equal(r.status, 404);
    r = await json(await post('x'.repeat(2 * 1024 * 1024).replace(/^/, '{"a":"') + '"}')); assert.deepEqual([r.status, r.body.error], [413, 'payload_too_large']);
    r = await json(await post('not json', 'text/plain')); assert.equal(r.status, 404);
  });
});

describe('error middleware under real Express 5 semantics', () => {
  const mount = async (config) => {
    const { notFound } = require('../src/middleware/notFound'); const { errorHandler } = require('../src/middleware/errorHandler');
    const logs = []; const app = express();
    app.get('/sync', () => { throw new Error('secret sync failure'); });
    app.get('/async', async () => { throw new Error('secret async failure'); });
    app.get('/client', () => { throw Object.assign(new Error('Nope'), { status: 409, expose: true }); });
    app.use(notFound); app.use(errorHandler(config, { error: (...a) => logs.push(a) }));
    return { server: await listen(app), logs };
  };

  // Only NODE_ENV=development may expose details; staging/test/unset/unknown must not. Uses the real config loader.
  const ENVS = [['development', 'development'], ['production', 'production'], ['staging', 'staging'], ['test', 'test'], ['unset', undefined], ['unknown', 'prod']];
  for (const [label, nodeEnv] of ENVS) {
    it(`sync and async (rejected promise) errors reach the handler - NODE_ENV ${label}`, async () => {
      const dev = nodeEnv === 'development';
      const { server, logs } = await mount(loadConfig(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv })); const base = urlOf(server);
      try {
        for (const p of ['/sync', '/async']) {
          const r = await json(await fetch(base + p)); const text = JSON.stringify(r.body);
          assert.equal(r.status, 500); assert.equal(r.body.error, 'internal_error'); assert.match(r.body.errorId, /^[0-9a-f]{12}$/);
          assert.equal(text.includes('secret'), dev); assert.equal('stack' in r.body, dev);
          if (dev) assert.ok(r.body.stack); else assert.equal(r.body.message, 'Unexpected server error');
        }
        assert.equal(logs.length, 2); assert.ok(logs.every((l) => l[1] instanceof Error && l[1].stack), 'full errors stay in server-side logs');
        const c = await json(await fetch(base + '/client')); assert.deepEqual([c.status, c.body.error, c.body.message], [409, 'http_error', 'Nope']);
      } finally { await close(server); }
    });
  }
});

describe('server.js process (real startup)', () => {
  const run = (env) => { const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; }); return { child, get out() { return out; }, get err() { return err; } }; };
  const exited = (child) => new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  const waitUp = async (url) => { for (let i = 0; i < 60; i++) { try { return await fetch(url); } catch { await new Promise((r) => setTimeout(r, 250)); } } throw new Error('server did not start'); };

  it('starts on PORT and serves requests (the final kill() is cleanup only, not a shutdown test)', async () => {
    const port = await freePort(); const p = run({ PORT: String(port), NODE_ENV: 'test' });
    try { const res = await waitUp(`http://127.0.0.1:${port}/`); assert.equal(res.status, 200); assert.match(p.out, new RegExp(`listening on port ${port}`)); }
    finally { p.child.kill(); await exited(p.child); }
  });
  // Graceful shutdown through the REAL signal handlers registered by src/server.js on the real child process.
  // Windows cannot deliver SIGINT/SIGTERM to a child (child.kill() hard-terminates), so the child raises the signal on itself with
  // process.emit(), which runs the exact same listeners on every platform; real exit code, output and port release are checked.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    it(`graceful shutdown on ${signal}: handler runs, server closes, process exits 0 (cross-platform)`, async () => {
      const port = await freePort();
      const script = `const { start } = require(${JSON.stringify(SERVER)}); const s = start(); s.once('listening', () => setTimeout(() => process.emit(${JSON.stringify(signal)}), 150));`;
      const child = spawn(process.execPath, ['-e', script], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
      try {
        const code = await within(exited(child), 15000, 'process exit');
        assert.equal(code, 0, `stderr: ${err}`); assert.match(out, new RegExp(`listening on port ${port}`)); assert.match(out, new RegExp(`${signal} received, shutting down`));
        await assert.rejects(fetch(`http://127.0.0.1:${port}/`)); // port released
      } finally { if (child.exitCode === null) child.kill(); }
    });
  }
  // OS-level signal delivery can only be exercised on POSIX; on Windows the emit-based tests above cover the same handlers.
  if (process.platform !== 'win32') {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      it(`graceful shutdown on an OS-delivered ${signal} (POSIX only)`, async () => {
        const port = await freePort(); const p = run({ PORT: String(port), NODE_ENV: 'test' });
        try {
          assert.equal((await waitUp(`http://127.0.0.1:${port}/`)).status, 200); p.child.kill(signal);
          assert.equal(await within(exited(p.child), 15000, 'process exit'), 0); assert.match(p.out, new RegExp(`${signal} received, shutting down`));
          await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
        } finally { if (p.child.exitCode === null) p.child.kill(); }
      });
    }
  }
  it('starts with a warning for an unrecognized NODE_ENV and for an unset NODE_ENV (no breaking rejection)', async () => {
    for (const [nodeEnv, pattern] of [['prod', /Unrecognized NODE_ENV "prod"/], ['', /NODE_ENV is not set/]]) {
      const port = await freePort(); const p = run({ PORT: String(port), NODE_ENV: nodeEnv });
      try { assert.equal((await waitUp(`http://127.0.0.1:${port}/`)).status, 200); for (let i = 0; i < 20 && !pattern.test(p.err); i++) await new Promise((r) => setTimeout(r, 100)); assert.match(p.err, pattern); }
      finally { p.child.kill(); await exited(p.child); }
    }
  });
  it('exits with code 1 and a clear message for an invalid PORT', async () => {
    const p = run({ PORT: 'abc' }); assert.equal(await exited(p.child), 1); assert.match(p.err, /Invalid PORT/);
  });
  it('exits with code 1 when the port is already in use', async () => {
    const blocker = net.createServer(); await new Promise((r) => blocker.listen(0, r)); const port = blocker.address().port;
    try {
      const p = run({ PORT: String(port) }); assert.equal(await within(exited(p.child), 15000, 'process exit'), 1);
      assert.match(p.err, /Failed to start server: port \d+ is already in use \(EADDRINUSE\)/);
      assert.doesNotMatch(p.err, /Unhandled|node:events|setupListenHandle|Error: listen/); // clean message, no unhandled 'error' event or raw stack
      assert.doesNotMatch(p.out, /listening on port/);
    } finally { blocker.close(); }
  });
});
