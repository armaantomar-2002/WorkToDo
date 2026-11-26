'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { autoDraft } = require('../src/modules/planner/autoDraft');

// Minimal req/res stand-ins (express is not needed): `authenticate` runs INSIDE the route chain, i.e. after autoDraft, exactly as in api/index.js.
function run({ method = 'POST', authed, status = 200, endTwice = false }) {
  const calls = []; const svc = { refreshDraftIfNeeded: async (id) => { calls.push(id); } };
  const sent = []; const res = { statusCode: status, end: (...a) => { sent.push(a); return res; } };
  const req = { method, originalUrl: '/api/tasks', headers: {} };
  const authenticate = (rq) => { if (authed) rq.auth = { userId: 'u1' }; else res.statusCode = 401; }; // real requireAuth: sets req.auth or errors 401
  const mw = autoDraft({ scheduleService: svc });
  return new Promise((resolve) => {
    mw(req, res, () => { authenticate(req); res.end('body'); if (endTwice) res.end('again'); setTimeout(() => resolve({ calls, sent }), 10); });
  });
}

test('authenticated mutation triggers exactly one draft refresh for that user, response still sent', async () => {
  const { calls, sent } = await run({ authed: true });
  assert.deepEqual(calls, ['u1']); assert.equal(sent.length, 1);
});
test('unauthenticated request (401, no req.auth) triggers no refresh', async () => {
  const { calls, sent } = await run({ authed: false, status: 200 });
  assert.equal(calls.length, 0); assert.equal(sent.length, 1);
});
test('failed request (>=400) triggers no refresh even when authenticated', async () => {
  const { calls } = await run({ authed: true, status: 409 });
  assert.equal(calls.length, 0);
});
test('GET requests never refresh', async () => {
  const { calls } = await run({ authed: true, method: 'GET' });
  assert.equal(calls.length, 0);
});
test('one mutation never refreshes twice, even if res.end is called twice', async () => {
  const { calls } = await run({ authed: true, endTwice: true });
  assert.equal(calls.length, 1);
});
test('a refresh failure never fails the user request', async () => {
  const errs = []; const svc = { refreshDraftIfNeeded: async () => { throw new Error('boom'); } };
  const sent = []; const res = { statusCode: 200, end: (...a) => { sent.push(a); return res; } }; const req = { method: 'DELETE', headers: {} };
  await new Promise((r) => autoDraft({ scheduleService: svc, onError: (e) => errs.push(e.message) })(req, res, () => { req.auth = { userId: 'u1' }; res.end('ok'); setTimeout(r, 10); }));
  assert.equal(sent.length, 1); assert.deepEqual(errs, ['boom']);
});
