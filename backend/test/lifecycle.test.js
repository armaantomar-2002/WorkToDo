'use strict';
// Unit tests for startup-error handling and graceful shutdown. They use plain Node http servers (no Express needed) and
// injected exit/logger/process objects, so they run identically on Windows, Linux and macOS.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { EventEmitter, once } = require('node:events');
const { listen, registerShutdown, startupMessage } = require('../src/lifecycle');

const CONFIG = { name: 'WorkToDo Backend', nodeEnv: 'test', port: 0, host: '127.0.0.1' };
const within = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms).unref())]);
const spies = () => {
  const logger = { out: [], err: [], log: (...a) => logger.out.push(a.join(' ')), error: (...a) => logger.err.push(a.join(' ')) };
  const calls = []; let resolve; const exited = new Promise((r) => { resolve = r; });
  return { logger, calls, exited, exit: (code) => { calls.push({ code, at: Date.now() }); resolve(code); } };
};
const startPlain = async (handler) => { const server = http.createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening'); return { server, url: `http://127.0.0.1:${server.address().port}/` }; };

describe('listen (startup errors)', () => {
  it('success: logs the same listening line and does not exit', async () => {
    const s = spies(); const server = http.createServer();
    listen(server, CONFIG, { logger: s.logger, exit: s.exit }); await once(server, 'listening');
    try { assert.match(s.logger.out[0], /^WorkToDo Backend \(test\) listening on port \d+$/); assert.deepEqual(s.calls, []); assert.deepEqual(s.logger.err, []); }
    finally { server.close(); }
  });
  it('EADDRINUSE: clear message, exit code 1 once, no success log, no unhandled error event', async () => {
    for (const host of ['127.0.0.1', undefined]) {
      const blocker = net.createServer(); await new Promise((r) => (host ? blocker.listen(0, host, r) : blocker.listen(0, r))); const port = blocker.address().port;
      const s = spies(); const server = http.createServer();
      try {
        listen(server, { ...CONFIG, port, host }, { logger: s.logger, exit: s.exit }); assert.equal(await within(s.exited, 5000, 'exit'), 1);
        assert.match(s.logger.err[0], new RegExp(`^Failed to start server: port ${port} is already in use \\(EADDRINUSE\\)\\. .*PORT`));
        assert.deepEqual(s.calls.map((c) => c.code), [1]); assert.deepEqual(s.logger.out, []);
      } finally { blocker.close(); }
    }
  });
  it('EACCES and unknown startup errors get clear messages and exit code 1', () => {
    for (const [err, pattern] of [[Object.assign(new Error('x'), { code: 'EACCES' }), /permission denied for port 80 \(EACCES\)/], [new Error('weird failure'), /^Failed to start server: weird failure$/]]) {
      const s = spies(); const server = http.createServer(); listen(server, { ...CONFIG, port: 80, host: '127.0.0.1' }, { logger: s.logger, exit: s.exit });
      server.emit('error', err); // synchronous: server.listening is still false here
      assert.match(s.logger.err[0], pattern); assert.deepEqual(s.calls.map((c) => c.code), [1]); server.close();
    }
    assert.match(startupMessage(Object.assign(new Error('x'), { code: 'EADDRINUSE' }), 5000), /port 5000 is already in use/);
  });
  it('an error after successful startup is logged and fatal (exit code 1), not unhandled', async () => {
    const s = spies(); const server = http.createServer(); listen(server, CONFIG, { logger: s.logger, exit: s.exit }); await once(server, 'listening');
    try { server.emit('error', new Error('boom')); assert.deepEqual(s.logger.err, ['Server error: boom']); assert.deepEqual(s.calls.map((c) => c.code), [1]); } finally { server.close(); }
  });
});

describe('registerShutdown (graceful SIGINT/SIGTERM)', () => {
  it('registers exactly one handler for each of SIGINT and SIGTERM on the given process', () => {
    const proc = new EventEmitter(); registerShutdown(http.createServer(), { proc, exit() {}, logger: spies().logger });
    assert.deepEqual([proc.listenerCount('SIGINT'), proc.listenerCount('SIGTERM')], [1, 1]);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    it(`${signal}: stops listening, logs, and exits 0 without firing the forced-exit timer`, async () => {
      const { server, url } = await startPlain((req, res) => res.end('ok')); const proc = new EventEmitter(); const s = spies();
      registerShutdown(server, { proc, exit: s.exit, logger: s.logger, timeoutMs: 300 });
      proc.emit(signal); assert.equal(await within(s.exited, 3000, 'exit'), 0);
      assert.deepEqual(s.logger.out, [`${signal} received, shutting down`]); assert.equal(server.listening, false);
      await assert.rejects(fetch(url)); await new Promise((r) => setTimeout(r, 450)); // past timeoutMs: timer must be cleared
      assert.deepEqual(s.calls.map((c) => c.code), [0]); assert.deepEqual(s.logger.err, []);
    });
  }
  it('lets an in-flight request finish, refuses new connections, then exits 0', async () => {
    const { server, url } = await startPlain((req, res) => setTimeout(() => res.end('done'), 300)); const proc = new EventEmitter(); const s = spies();
    registerShutdown(server, { proc, exit: s.exit, logger: s.logger, timeoutMs: 5000 });
    const inFlight = fetch(url).then(async (r) => ({ status: r.status, body: await r.text(), at: Date.now() }));
    await new Promise((r) => setTimeout(r, 60)); proc.emit('SIGTERM');
    await assert.rejects(fetch(url)); // new connection refused while shutting down
    const res = await within(inFlight, 3000, 'in-flight response'); assert.deepEqual([res.status, res.body], [200, 'done']);
    assert.equal(await within(s.exited, 3000, 'exit'), 0); assert.ok(s.calls[0].at >= res.at - 5, 'exit happens after the response completed');
  });
  it('an idle keep-alive connection does not delay shutdown', async () => {
    const { server, url } = await startPlain((req, res) => res.end('ok')); const proc = new EventEmitter(); const s = spies();
    registerShutdown(server, { proc, exit: s.exit, logger: s.logger, timeoutMs: 8000 });
    assert.equal(await (await fetch(url)).text(), 'ok'); const t0 = Date.now(); proc.emit('SIGINT');
    assert.equal(await within(s.exited, 4000, 'exit'), 0); assert.ok(Date.now() - t0 < 2500, `took ${Date.now() - t0}ms`);
  });
  it('exits 1 when connections do not finish within the timeout', async () => {
    const { server, url } = await startPlain(() => { /* never responds */ }); const proc = new EventEmitter(); const s = spies();
    registerShutdown(server, { proc, exit: s.exit, logger: s.logger, timeoutMs: 150 });
    const hung = fetch(url).catch(() => {}); await new Promise((r) => setTimeout(r, 50)); proc.emit('SIGTERM');
    try { assert.equal(await within(s.exited, 3000, 'forced exit'), 1); assert.match(s.logger.err[0], /Shutdown timed out/); }
    finally { server.closeAllConnections(); await hung; }
  });
  it('ignores repeated signals (single shutdown, single exit)', async () => {
    const { server } = await startPlain((req, res) => res.end('ok')); const proc = new EventEmitter(); const s = spies();
    registerShutdown(server, { proc, exit: s.exit, logger: s.logger, timeoutMs: 2000 });
    proc.emit('SIGINT'); proc.emit('SIGTERM'); proc.emit('SIGINT'); await within(s.exited, 3000, 'exit'); await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(s.logger.out, ['SIGINT received, shutting down']); assert.deepEqual(s.calls.map((c) => c.code), [0]);
  });
});
