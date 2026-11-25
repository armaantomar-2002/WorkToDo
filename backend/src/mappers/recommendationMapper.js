'use strict';
const { SESSION_FIELDS, TASK_FIELDS, RANKED_FIELDS, EXCLUDED_FIELDS, SUMMARY_FIELDS } = require('./fields');

// Pure field renaming/whitelisting. No scoring, no ranking, no Date/timezone handling: values (including the local
// wall-clock string in `localTime`) are passed through exactly as validated, never parsed or converted.

function pick(source, fields, fromIndex, toIndex) {
  const out = {};
  for (const field of fields) if (Object.hasOwn(source, field[fromIndex])) out[field[toIndex]] = source[field[fromIndex]];
  return out;
}

/** Validated public request -> exact Python /recommend payload. Only supplied fields are emitted (omitted stays omitted, null stays null). */
function toPythonRequest({ session, tasks, topK }) {
  const payload = { session: pick(session, SESSION_FIELDS, 0, 1), tasks: tasks.map((t) => pick(t, TASK_FIELDS, 0, 1)) };
  if (topK !== undefined) payload.top_k = topK;
  return payload;
}

/** Validated Python response -> public response (camelCase, same values, same order). Unknown Python fields are not forwarded. */
function toPublicResponse(py) {
  return {
    ranked: py.ranked.map((item) => pick(item, RANKED_FIELDS, 1, 0)),
    excluded: py.excluded.map((item) => pick(item, EXCLUDED_FIELDS, 1, 0)),
    summary: pick(py.summary, SUMMARY_FIELDS, 1, 0),
  };
}

module.exports = { toPythonRequest, toPublicResponse };
