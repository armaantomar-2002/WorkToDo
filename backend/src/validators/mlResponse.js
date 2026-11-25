'use strict';
const { AppError } = require('../errors/AppError');
const { RANKED_FIELDS, EXCLUDED_FIELDS, SUMMARY_FIELDS, FACTOR_FIELDS } = require('../mappers/fields');

const CATEGORIES = new Set(['Do now', 'Do next', 'Schedule later']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => (typeof v === 'string' && v !== '') || Number.isSafeInteger(v);
const isScore = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const isCount = (v) => Number.isInteger(v) && v >= 0;

function invalid(reason) {
  return new AppError({ status: 502, code: 'ml_invalid_response', message: 'The recommendation service returned an invalid response.', logContext: { contractViolation: reason } });
}

/**
 * Verifies the Python /recommend response contract before anything is returned to a client. `ctx.requestedTasks` is the
 * number of tasks sent; `ctx.topK` the requested limit (if any). Throws AppError(502 ml_invalid_response); the reason is logged only.
 */
function validateMlResponse(raw, ctx = {}) {
  if (!isObj(raw)) throw invalid('response is not an object');
  const { ranked, excluded, summary } = raw;
  if (!Array.isArray(ranked) || !Array.isArray(excluded) || !isObj(summary)) throw invalid('ranked/excluded/summary missing or wrong type');
  ranked.forEach((item, i) => {
    if (!isObj(item)) throw invalid(`ranked[${i}] is not an object`);
    for (const [, py] of RANKED_FIELDS) if (!(py in item)) throw invalid(`ranked[${i}] lacks ${py}`);
    if (!Number.isInteger(item.rank) || item.rank !== i + 1) throw invalid(`ranked[${i}].rank is not sequential`);
    if (!isId(item.task_id)) throw invalid(`ranked[${i}].task_id invalid`);
    if (item.task_name !== null && typeof item.task_name !== 'string') throw invalid(`ranked[${i}].task_name invalid`);
    if (!isScore(item.ml_score)) throw invalid(`ranked[${i}].ml_score out of range`);
    if (!CATEGORIES.has(item.category)) throw invalid(`ranked[${i}].category unknown`);
    if (typeof item.startable_now !== 'boolean') throw invalid(`ranked[${i}].startable_now invalid`);
    if (typeof item.reason !== 'string') throw invalid(`ranked[${i}].reason invalid`);
    for (const [, py] of FACTOR_FIELDS) if (!isScore(item[py])) throw invalid(`ranked[${i}].${py} out of range`);
  });
  excluded.forEach((item, i) => {
    if (!isObj(item) || !EXCLUDED_FIELDS.every(([, py]) => py in item)) throw invalid(`excluded[${i}] malformed`);
    if (!isId(item.task_id) || typeof item.exclusion_reason !== 'string') throw invalid(`excluded[${i}] invalid values`);
  });
  for (const [, py] of SUMMARY_FIELDS) if (!isCount(summary[py])) throw invalid(`summary.${py} invalid`);
  if (summary.returned !== ranked.length) throw invalid('summary.returned does not match ranked length');
  if (summary.excluded !== excluded.length) throw invalid('summary.excluded does not match excluded length');
  if (summary.total_tasks !== summary.eligible + summary.excluded) throw invalid('summary counts are inconsistent');
  if (summary.startable_now > summary.eligible) throw invalid('summary.startable_now exceeds eligible');
  if (ctx.requestedTasks !== undefined && summary.total_tasks !== ctx.requestedTasks) throw invalid('total_tasks differs from the number of tasks sent');
  const expectedReturned = ctx.topK === undefined ? summary.eligible : Math.min(ctx.topK, summary.eligible);
  if (summary.returned !== expectedReturned) throw invalid('returned count inconsistent with topK');
  return raw;
}

module.exports = { validateMlResponse, CATEGORIES };
