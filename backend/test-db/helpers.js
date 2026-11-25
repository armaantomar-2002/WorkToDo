'use strict';
// Shared helpers for the real-database tests (npm run test:db). Requires: PostgreSQL with the test database migrated
// (`npm run db:deploy` against DATABASE_URL from .env.test), `npm install`, and `npx prisma generate`.
const http = require('node:http');
const { loadConfig } = require('../src/config/env');
const { createApp } = require('../src/app');
const { createPrismaClient } = require('../src/db/prisma');

function testConfig(extra = {}) {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', ...extra });
  const dbName = new URL(config.database.url ?? 'postgresql://x/none').pathname.replace('/', '');
  if (!config.database.url || !/_test$/.test(dbName)) throw new Error(`Refusing to run: DATABASE_URL must point to a database whose name ends in "_test" (got "${dbName}"). Use .env.test.`);
  return config;
}

/** Deterministic stand-in for the Python service (the real engine is covered by test-live/). Mirrors the Python wire format. */
function fakeMlClient(calls = []) {
  const FACTORS = { urgency: 60, importance: 70, goal_contribution: 50, feasibility: 80, consequence_of_delay: 40, timing_suitability: 90, energy_suitability: 75 };
  return {
    calls,
    async recommend(payload) {
      calls.push(payload);
      const active = payload.tasks.filter((t) => t.status === 'Pending' || t.status === 'In Progress');
      const inactive = payload.tasks.filter((t) => !active.includes(t));
      let ranked = active.map((t, i) => ({ rank: i + 1, task_id: t.task_id, task_name: t.task_name ?? null, ml_score: 95 - i * 3, category: i === 0 ? 'Do now' : i < 3 ? 'Do next' : 'Schedule later', startable_now: true, reason: `Ranked #${i + 1}`, ...FACTORS }));
      if (payload.top_k) ranked = ranked.slice(0, payload.top_k);
      return { ranked, excluded: inactive.map((t) => ({ task_id: t.task_id, exclusion_reason: 'Task not active' })), summary: { total_tasks: payload.tasks.length, eligible: active.length, excluded: inactive.length, returned: ranked.length, startable_now: ranked.length } };
    },
    async checkReadiness() { return { status: 'ok', ready: true, modelLoaded: true, preprocessorLoaded: true }; },
  };
}

async function startServer(overrides = {}) {
  const config = testConfig(overrides.env);
  const prisma = createPrismaClient(config);
  const mlClient = overrides.mlClient ?? fakeMlClient();
  const emails = [];
  const emailProvider = { name: 'capture', async send(m) { emails.push(m); return { delivered: false }; } };
  const server = http.createServer(createApp(config, { prisma, mlClient, emailProvider, now: overrides.now }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); };
  return { base, prisma, config, mlClient, emails, close };
}

async function resetDatabase(prisma) { await prisma.$executeRawUnsafe('TRUNCATE "User" CASCADE'); }

/** Tiny cookie-aware API client. Sends the CSRF header + an allowed Origin like the real frontend does. */
function createClient(base, origin = 'http://localhost:5173') {
  let cookie = '';
  let token = null;
  async function request(method, path, body, { auth = true, headers = {}, csrf = true } = {}) {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-Requested-With': 'WorkToDo', Origin: origin } : {}), ...(auth && token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) { const [pair] = c.split(';'); const [n, v] = pair.split('='); cookie = v === '' || /Max-Age=0/i.test(c) ? '' : `${n}=${v}`; }
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (json && json.accessToken) token = json.accessToken;
    return { status: res.status, body: json, setCookie: set, headers: res.headers };
  }
  return { request, get: (p, o) => request('GET', p, undefined, o), post: (p, b, o) => request('POST', p, b ?? {}, o), patch: (p, b, o) => request('PATCH', p, b, o), put: (p, b, o) => request('PUT', p, b ?? {}, o), del: (p, o) => request('DELETE', p, undefined, o), setToken: (t) => { token = t; }, getCookie: () => cookie, setCookie: (c) => { cookie = c; } };
}

const TASK = { taskName: 'Write report', importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Significant', complexity: 'Moderate', estimatedDurationMinutes: 60, dueDate: '2026-12-31' };
const SESSION = { sessionDateTime: '2026-11-24 09:00:00', availableTimeMinutes: 120, longestFreeSlotMinutes: 90, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'Medium' };
async function registerUser(base, email = 'user@example.com', fullName = 'Test User') {
  const c = createClient(base);
  const r = await c.post('/auth/register', { fullName, email, password: 'Password123' });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { client: c, user: r.body.user };
}
module.exports = { startServer, resetDatabase, createClient, registerUser, fakeMlClient, testConfig, TASK, SESSION };
