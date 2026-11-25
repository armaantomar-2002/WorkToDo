'use strict';
// Hermetic tests for the new pure modules: dates, validator, task/session/run validators, insights maths, cookies, security middleware, config.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../src/utils/dates');
const { parseBody, validateBody, assertUuid } = require('../src/http/validate');
const tasksV = require('../src/modules/tasks/tasks.validator');
const sessV = require('../src/modules/sessions/sessions.validator');
const runsV = require('../src/modules/recommendations/runs.validator');
const calc = require('../src/modules/insights/insights.calc');
const { parseCookies, serializeRefreshCookie } = require('../src/http/cookies');
const { cors, csrfGuard } = require('../src/http/security');
const { passwordProblem } = require('../src/auth/password');
const { generateOpaqueToken, hashToken } = require('../src/auth/tokens');
const { loadConfig, assertDatabaseConfigured } = require('../src/config/env');
const { createEmailProvider } = require('../src/email/provider');

const throwsAt = (fn, field) => { try { fn(); } catch (e) { assert.equal(e.status, 422); assert.ok(e.errors.some((x) => x.field === field), JSON.stringify(e.errors)); return; } assert.fail('expected a validation error'); };
const TASK = { taskName: ' Write report ', importance: 'High', goalContribution: 'Essential', consequenceOfDelay: 'Major', complexity: 'Moderate', estimatedDurationMinutes: 90 };

describe('dates', () => {
  test('wall-clock round trip never shifts (no timezone applied)', () => {
    for (const s of ['2026-03-08 02:30:00', '2026-11-01 01:30:00', '2026-12-31 23:59:59']) assert.equal(dates.formatLocalDateTime(dates.parseLocalDateTime(s)), s);
    assert.equal(dates.formatLocalDateTime(dates.parseLocalDateTime('2026-11-24T09:05')), '2026-11-24 09:05:00');
  });
  test('rejects impossible dates, offsets, fractions and date-only for date-times', () => {
    for (const s of ['2026-02-30 10:00', '2026-11-24 24:00', '2026-11-24 10:00:00Z', '2026-11-24 10:00:00.5', '2026-11-24', 'abc', null]) assert.equal(dates.parseLocalDateTime(s), null, String(s));
    assert.equal(dates.parseDateOnly('2026-02-29'), null); assert.ok(dates.parseDateOnly('2028-02-29'));
  });
  test('date-only values round trip and add days across month/year', () => {
    assert.equal(dates.formatDateOnly(dates.parseDateOnly('2026-11-24')), '2026-11-24');
    assert.equal(dates.addDays('2026-12-31', 1), '2027-01-01'); assert.equal(dates.addDays('2026-03-01', -1), '2026-02-28');
  });
  test('dayKeyInZone buckets an instant by the user time zone', () => {
    const t = new Date('2026-11-24T20:00:00Z');
    assert.equal(dates.dayKeyInZone(t, 'UTC'), '2026-11-24'); assert.equal(dates.dayKeyInZone(t, 'Asia/Kolkata'), '2026-11-25'); assert.equal(dates.dayKeyInZone(t, 'America/Los_Angeles'), '2026-11-24');
    assert.equal(dates.dayKeyInZone(t, 'Not/AZone'), '2026-11-24');
    assert.ok(dates.isValidTimeZone('Europe/London')); assert.ok(!dates.isValidTimeZone('nope'));
  });
});

describe('whitelist validator', () => {
  test('rejects unknown fields, nulls, wrong types; trims strings; lowercases email', () => {
    const spec = { name: { type: 'string', required: true, minLength: 1, maxLength: 5 }, mail: { type: 'email' }, n: { type: 'int', min: 1, max: 3 } };
    assert.deepEqual(validateBody({ name: '  ab ', mail: ' A@B.Co ' }, spec), { name: 'ab', mail: 'a@b.co' });
    const { errors } = parseBody({ name: '', n: 4, x: 1, mail: 'bad' }, spec);
    assert.deepEqual(errors.map((e) => e.field).sort(), ['mail', 'n', 'name', 'x']);
    assert.equal(parseBody([], spec).errors[0].field, 'body');
    assert.equal(parseBody({ name: null }, spec).errors[0].message, 'must not be null');
  });
  test('assertUuid turns malformed ids into 404 (never reaches the database)', () => {
    assert.throws(() => assertUuid('1; DROP TABLE'), (e) => e.status === 404);
    assert.equal(assertUuid('3F2504E0-4F89-41D3-9A0C-0305E82C3301'), '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  });
});

describe('task validator', () => {
  test('applies defaults and normalises', () => {
    const t = tasksV.createInput(TASK);
    assert.equal(t.taskName, 'Write report'); assert.equal(t.status, 'Pending'); assert.equal(t.preferredTime, 'Anytime'); assert.equal(t.dependencyStatus, undefined, 'derived server-side from real dependencies, never client-supplied'); assert.equal(t.isSplittable, false); assert.equal(t.minimumSessionMinutes, null);
  });
  test('non-splittable tasks drop minimumSessionMinutes; splittable ones require a valid one', () => {
    assert.equal(tasksV.createInput({ ...TASK, minimumSessionMinutes: 30 }).minimumSessionMinutes, null);
    throwsAt(() => tasksV.createInput({ ...TASK, isSplittable: true }), 'minimumSessionMinutes');
    throwsAt(() => tasksV.createInput({ ...TASK, isSplittable: true, minimumSessionMinutes: 91 }), 'minimumSessionMinutes');
    assert.equal(tasksV.createInput({ ...TASK, isSplittable: true, minimumSessionMinutes: 30 }).minimumSessionMinutes, 30);
  });
  test('enum, date and range rules mirror the ML contract / DB constraints', () => {
    throwsAt(() => tasksV.createInput({ ...TASK, importance: 'Urgent' }), 'importance');
    throwsAt(() => tasksV.createInput({ ...TASK, consequenceOfDelay: 'No consequence' }), 'consequenceOfDelay');
    throwsAt(() => tasksV.createInput({ ...TASK, startDate: '2026-12-05', dueDate: '2026-12-01' }), 'dueDate');
    throwsAt(() => tasksV.createInput({ ...TASK, dueDate: '2026-02-30' }), 'dueDate');
    throwsAt(() => tasksV.createInput({ ...TASK, estimatedDurationMinutes: 0 }), 'estimatedDurationMinutes');
    throwsAt(() => tasksV.createInput({ ...TASK, userId: 'x' }), 'userId'); // ownership can never be supplied by the client
    throwsAt(() => tasksV.createInput({ ...TASK, id: 'x' }), 'id');
  });
  test('update merges onto the existing task before cross-field checks', () => {
    const existing = { ...tasksV.createInput({ ...TASK, isSplittable: true, minimumSessionMinutes: 60 }) };
    throwsAt(() => tasksV.updateInput({ estimatedDurationMinutes: 30 }, existing), 'minimumSessionMinutes');
    assert.deepEqual(tasksV.updateInput({ isSplittable: false }, existing).patch, { isSplittable: false, minimumSessionMinutes: null });
    throwsAt(() => tasksV.updateInput({}, existing), 'body');
  });
  test('list query: defaults, csv filters, bounds', () => {
    const q = tasksV.listQuery({ status: 'Pending,In Progress', page: '2', pageSize: '25', sortBy: 'dueDate', sortOrder: 'asc', search: 'rep' });
    assert.deepEqual([q.status, q.page, q.pageSize, q.sortBy, q.sortOrder, q.search], [['Pending', 'In Progress'], 2, 25, 'dueDate', 'asc', 'rep']);
    assert.deepEqual([tasksV.listQuery({}).page, tasksV.listQuery({}).pageSize, tasksV.listQuery({}).sortBy], [1, 10, 'createdAt']);
    throwsAt(() => tasksV.listQuery({ status: 'Pending,Bogus' }), 'status'); throwsAt(() => tasksV.listQuery({ pageSize: '1000' }), 'pageSize'); throwsAt(() => tasksV.listQuery({ sortBy: 'passwordHash' }), 'sortBy'); throwsAt(() => tasksV.listQuery({ page: '0' }), 'page');
  });
});

describe('session and run validators', () => {
  const S = { sessionDateTime: '2026-11-24 09:00:00', availableTimeMinutes: 120, longestFreeSlotMinutes: 90, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'Medium' };
  test('session rules', () => {
    assert.deepEqual(sessV.createInput(S), S);
    throwsAt(() => sessV.createInput({ ...S, longestFreeSlotMinutes: 121 }), 'longestFreeSlotMinutes');
    throwsAt(() => sessV.createInput({ ...S, sessionDateTime: '2026-11-24T09:00:00Z' }), 'sessionDateTime');
    throwsAt(() => sessV.createInput({ ...S, currentTimePeriod: 'Noon' }), 'currentTimePeriod');
    throwsAt(() => sessV.updateInput({ availableTimeMinutes: 30 }, S), 'longestFreeSlotMinutes');
  });
  test('run input: saved session XOR complete inline context', () => {
    const inline = { localTime: '2026-11-24 09:00', availableTimeMinutes: 60, longestFreeSlotMinutes: 45, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High' };
    assert.equal(runsV.runInput({ ...inline, topK: 5 }).topK, 5);
    assert.ok(runsV.runInput({ focusSessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' }));
    throwsAt(() => runsV.runInput({ focusSessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', energyLevel: 'Low' }), 'energyLevel');
    throwsAt(() => runsV.runInput({ ...inline, energyLevel: undefined }), 'energyLevel');
    throwsAt(() => runsV.runInput({ ...inline, longestFreeSlotMinutes: 61 }), 'longestFreeSlotMinutes');
    throwsAt(() => runsV.runInput({ ...inline, tasks: [] }), 'tasks'); // the client can never supply the task list
    throwsAt(() => runsV.runInput({ focusSessionId: 'nope' }), 'focusSessionId');
  });
});

describe('insights maths', () => {
  test('dayRange ends today and has the requested length', () => { const r = calc.dayRange('2026-11-24', 7); assert.equal(r.length, 7); assert.equal(r[0], '2026-11-18'); assert.equal(r[6], '2026-11-24'); });
  test('completionTrend zero-fills and buckets by time zone', () => {
    const days = calc.dayRange('2026-11-25', 3);
    const t = calc.completionTrend({ days, completedAt: [new Date('2026-11-24T20:00:00Z'), new Date('2026-11-01T00:00:00Z')], createdAt: [], timeZone: 'Asia/Kolkata' });
    assert.deepEqual(t.map((d) => d.completed), [0, 0, 1]); assert.deepEqual(t.map((d) => d.date), ['2026-11-23', '2026-11-24', '2026-11-25']);
  });
  test('sessionTrend sums planned minutes per wall-clock day; distribution keeps empty buckets; rate/average handle zero', () => {
    const days = calc.dayRange('2026-11-24', 2);
    const tr = calc.sessionTrend({ days, sessions: [{ sessionDateTime: dates.parseLocalDateTime('2026-11-24 09:00'), availableTimeMinutes: 60 }, { sessionDateTime: dates.parseLocalDateTime('2026-11-24 15:00'), availableTimeMinutes: 30 }, { sessionDateTime: dates.parseLocalDateTime('2026-10-01 15:00'), availableTimeMinutes: 99 }] });
    assert.deepEqual(tr, [{ date: '2026-11-23', sessions: 0, plannedMinutes: 0 }, { date: '2026-11-24', sessions: 2, plannedMinutes: 90 }]);
    assert.deepEqual(calc.distribution(['Low', 'High'], ['High', 'High', 'Bogus']), [{ name: 'Low', count: 0 }, { name: 'High', count: 2 }]);
    assert.equal(calc.rate(0, 0), 0); assert.equal(calc.rate(1, 3), 33.3); assert.equal(calc.average([]), 0); assert.equal(calc.average([30, 45]), 37.5);
  });
});

describe('cookies, CORS and CSRF', () => {
  const cookies = { name: 'wt_refresh', path: '/api/v1/auth', secure: true };
  test('refresh cookie is HttpOnly, SameSite=Strict, path-scoped; Secure follows config; clearing expires it', () => {
    const c = serializeRefreshCookie(cookies, 'tok', 604800); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Path=\/api\/v1\/auth/); assert.match(c, /Secure/); assert.match(c, /Max-Age=604800/);
    assert.doesNotMatch(serializeRefreshCookie({ ...cookies, secure: false }, 'tok', 5), /Secure/);
    assert.match(serializeRefreshCookie(cookies, '', 0), /Max-Age=0.*Expires=Thu, 01 Jan 1970/);
  });
  test('parseCookies', () => { assert.deepEqual(parseCookies('a=1; wt_refresh=x%20y; bad'), { a: '1', wt_refresh: 'x y' }); assert.deepEqual(parseCookies(undefined), {}); });
  const run = (mw, req) => new Promise((resolve) => {
    const headers = {}; const res = { setHeader: (k, v) => { headers[k] = v; }, append: (k, v) => { headers[k] = v; }, status(c) { this.code = c; return this; }, end() { resolve({ code: this.code, headers }); } };
    mw({ method: 'GET', headers: {}, ...req }, res, (err) => resolve({ next: true, err, headers }));
  });
  test('CORS: only allow-listed origins get credentialed access; pre-flight answered', async () => {
    const mw = cors(['http://localhost:5173']);
    assert.equal((await run(mw, { headers: { origin: 'http://localhost:5173' } })).headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
    assert.equal((await run(mw, { headers: { origin: 'http://evil.example' } })).headers['Access-Control-Allow-Origin'], undefined);
    const pre = await run(mw, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
    assert.equal(pre.code, 204); assert.match(pre.headers['Access-Control-Allow-Headers'], /X-Requested-With/);
  });
  test('CSRF guard: unsafe methods need the custom header and an allowed Origin', async () => {
    const mw = csrfGuard(['http://localhost:5173']);
    assert.equal((await run(mw, { method: 'GET' })).err, undefined);
    assert.equal((await run(mw, { method: 'POST', headers: {} })).err.code, 'csrf_header_missing');
    assert.equal((await run(mw, { method: 'POST', headers: { origin: 'http://evil.example', 'x-requested-with': 'WorkToDo' } })).err.code, 'forbidden_origin');
    assert.equal((await run(mw, { method: 'DELETE', headers: { origin: 'http://localhost:5173', 'x-requested-with': 'WorkToDo' } })).err, undefined);
  });
});

describe('password policy, opaque tokens, email provider', () => {
  test('password policy', () => { assert.ok(passwordProblem('short1')); assert.ok(passwordProblem('allletters')); assert.ok(passwordProblem('12345678')); assert.equal(passwordProblem('abcdefg1'), null); assert.ok(passwordProblem('a1'.repeat(70))); });
  test('opaque tokens: 256-bit random, stored as SHA-256 only', () => {
    const a = generateOpaqueToken(); const b = generateOpaqueToken();
    assert.notEqual(a.token, b.token); assert.equal(a.hash, hashToken(a.token)); assert.match(a.hash, /^[0-9a-f]{64}$/); assert.ok(a.token.length >= 43); assert.ok(!a.hash.includes(a.token));
  });
  test('email provider never claims delivery and never logs in production', async () => {
    const logs = []; const logger = { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]) };
    const dev = createEmailProvider(loadConfig({ NODE_ENV: 'development' }), logger); assert.deepEqual(await dev.send({ to: 'a@b.co', subject: 's', text: 'link' }), { delivered: false }); assert.match(logs[0][1], /NOT DELIVERED/);
    logs.length = 0; const prod = createEmailProvider(loadConfig({ NODE_ENV: 'production', ML_SERVICE_URL: 'http://x:8000' }), logger); await prod.send({ to: 'a@b.co', subject: 's', text: 'SECRETLINK' });
    assert.equal(prod.name, 'none'); assert.ok(!logs.some(([, m]) => m.includes('SECRETLINK')));
  });
});

describe('database/auth configuration', () => {
  const DB = 'postgresql://worktodo:pw@localhost:5432/worktodo';
  const SECRET = 'x'.repeat(40);
  test('defaults: no database, stateless endpoint on, dev CORS origins', () => {
    const c = loadConfig({ NODE_ENV: 'development' }); assert.equal(c.database.url, undefined); assert.equal(c.features.statelessRecommendations, true); assert.ok(c.cors.allowedOrigins.includes('http://localhost:5173')); assert.equal(c.cookies.secure, false); assert.doesNotThrow(() => assertDatabaseConfigured(c));
  });
  test('DATABASE_URL requires a strong JWT secret; production requires explicit origins; stateless endpoint off in production', () => {
    assert.throws(() => assertDatabaseConfigured(loadConfig({ NODE_ENV: 'development', DATABASE_URL: DB })), /JWT_ACCESS_SECRET/);
    assert.throws(() => assertDatabaseConfigured(loadConfig({ NODE_ENV: 'development', DATABASE_URL: DB, JWT_ACCESS_SECRET: 'short' })), /JWT_ACCESS_SECRET/);
    assert.doesNotThrow(() => assertDatabaseConfigured(loadConfig({ NODE_ENV: 'development', DATABASE_URL: DB, JWT_ACCESS_SECRET: SECRET })));
    const prod = { NODE_ENV: 'production', DATABASE_URL: DB, JWT_ACCESS_SECRET: SECRET, ML_SERVICE_URL: 'http://ml:8000' };
    assert.throws(() => assertDatabaseConfigured(loadConfig(prod)), /FRONTEND_ORIGIN/);
    const ok = loadConfig({ ...prod, FRONTEND_ORIGIN: 'https://app.example.com' }); assert.doesNotThrow(() => assertDatabaseConfigured(ok)); assert.equal(ok.features.statelessRecommendations, false); assert.equal(ok.cookies.secure, true);
    assert.equal(loadConfig({ ...prod, FRONTEND_ORIGIN: 'https://a.example', ENABLE_STATELESS_RECOMMENDATIONS: 'true' }).features.statelessRecommendations, true);
    assert.throws(() => assertDatabaseConfigured(loadConfig({ ...prod, FRONTEND_ORIGIN: 'https://a.example', COOKIE_SECURE: 'false' })), /COOKIE_SECURE/);
  });
  test('invalid values fail fast', () => {
    assert.throws(() => loadConfig({ DATABASE_URL: 'mysql://x' }), /DATABASE_URL/); assert.throws(() => loadConfig({ FRONTEND_ORIGIN: 'not a url' }), /FRONTEND_ORIGIN/);
    assert.throws(() => loadConfig({ ACCESS_TOKEN_TTL_SECONDS: '5' }), /ACCESS_TOKEN_TTL_SECONDS/); assert.throws(() => loadConfig({ EMAIL_PROVIDER: 'smtp' }), /EMAIL_PROVIDER/); assert.throws(() => loadConfig({ COOKIE_SECURE: 'maybe' }), /boolean/);
  });
});
