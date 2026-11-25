'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateMlResponse: validate } = require('../src/validators/mlResponse');
const { AppError } = require('../src/errors/AppError');

const SC = ['golden', 'empty', 'all-excluded', 'zero-time', 'top-k'].map((n) => require(`./fixtures/ml/scenario-${n}.json`));
const golden = SC[0];
const clone = (o) => JSON.parse(JSON.stringify(o));
const ctx = (s) => ({ requestedTasks: s.pythonRequest.tasks.length, topK: s.pythonRequest.top_k });
const bad = (mutate, c = ctx(golden)) => { const r = clone(golden.pythonResponse); mutate(r); assert.throws(() => validate(r, c), (e) => e instanceof AppError && e.status === 502 && e.code === 'ml_invalid_response' && e.message === 'The recommendation service returned an invalid response.' && typeof e.logContext.contractViolation === 'string'); };

describe('Python response contract validation', () => {
  it('accepts every real engine response (incl. empty, all-excluded, zero-time, top-k)', () => { for (const s of SC) assert.equal(validate(clone(s.pythonResponse), ctx(s)) !== undefined, true, s.name); });
  it('rejects non-objects and missing top-level parts', () => {
    for (const r of [null, undefined, 'x', 5, [], {}]) assert.throws(() => validate(r), AppError);
    bad((r) => { delete r.ranked; }); bad((r) => { delete r.excluded; }); bad((r) => { delete r.summary; }); bad((r) => { r.ranked = {}; });
  });
  it('rejects malformed ranked items', () => {
    bad((r) => { delete r.ranked[0].ml_score; }); bad((r) => { r.ranked[0].ml_score = '88.3'; }); bad((r) => { r.ranked[0].ml_score = 101; }); bad((r) => { r.ranked[0].ml_score = -0.1; }); bad((r) => { r.ranked[0].ml_score = null; });
    bad((r) => { r.ranked[0].category = 'Do later'; }); bad((r) => { r.ranked[0].startable_now = 'yes'; }); bad((r) => { r.ranked[0].reason = 5; }); bad((r) => { r.ranked[0].urgency = 120; }); bad((r) => { r.ranked[1].energy_suitability = 'high'; });
    bad((r) => { r.ranked[0].task_id = null; }); bad((r) => { r.ranked[0].task_id = 1.5; }); bad((r) => { r.ranked[0].task_name = 5; }); bad((r) => { r.ranked[1].rank = 5; }); bad((r) => { r.ranked[0] = null; });
  });
  it('rejects malformed excluded items and summaries', () => {
    bad((r) => { r.excluded[0] = {}; }); bad((r) => { r.excluded[0].exclusion_reason = 5; });
    bad((r) => { r.summary.total_tasks = 'a'; }); bad((r) => { r.summary.eligible = -1; }); bad((r) => { delete r.summary.startable_now; });
    bad((r) => { r.summary.returned = 5; }); bad((r) => { r.summary.excluded = 0; }); bad((r) => { r.summary.total_tasks = 99; }); bad((r) => { r.summary.startable_now = 9; });
  });
  it('rejects responses inconsistent with the request (task count, topK)', () => {
    bad(() => {}, { requestedTasks: 4 }); const k = SC[4]; const r = clone(k.pythonResponse);
    assert.throws(() => validate(r, { requestedTasks: 6, topK: 2 }), AppError); assert.throws(() => validate(r, { requestedTasks: 6 }), AppError); validate(r, { requestedTasks: 6, topK: 3 });
  });
  it('unknown extra Python fields are tolerated (they are simply not forwarded)', () => { const r = clone(golden.pythonResponse); r.extra = 1; r.ranked[0].future_field = 'x'; validate(r, ctx(golden)); });
  it('the violation reason is for logs only (not part of the error message)', () => { try { validate({}); } catch (e) { assert.ok(!e.message.includes('missing')); assert.ok(e.logContext.contractViolation); } });
});
