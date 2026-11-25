'use strict';
const { validateBody, validateQuery, validationError, UUID_RE } = require('../../http/validate');

const uuidField = (name, v) => { if (v !== undefined && v !== null && !UUID_RE.test(v)) throw validationError([{ field: name, message: 'must be a valid id' }]); };

function startInput(body) {
  const d = validateBody(body, {
    taskId: { type: 'string', nullable: true, maxLength: 36 }, focusSessionId: { type: 'string', nullable: true, maxLength: 36 },
    plannedDurationMinutes: { type: 'int', min: 1, max: 720 },
  });
  uuidField('taskId', d.taskId); uuidField('focusSessionId', d.focusSessionId);
  const lc = (x) => (x ? x.toLowerCase() : null);
  return { taskId: lc(d.taskId), focusSessionId: lc(d.focusSessionId), plannedDurationMinutes: d.plannedDurationMinutes };
}
/** finish accepts an optional flag to also mark the linked task Completed. */
const finishInput = (body) => validateBody(body ?? {}, { completeTask: { type: 'boolean' } });
const noBody = (body) => validateBody(body ?? {}, {});
const historyQuery = (q) => {
  const d = validateQuery(q, { page: { type: 'int', min: 1, max: 100000 }, pageSize: { type: 'int', min: 1, max: 50 }, taskId: { type: 'string', maxLength: 36 } });
  uuidField('taskId', d.taskId);
  return { page: d.page ?? 1, pageSize: d.pageSize ?? 10, taskId: d.taskId ? d.taskId.toLowerCase() : undefined };
};
module.exports = { startInput, finishInput, noBody, historyQuery };
