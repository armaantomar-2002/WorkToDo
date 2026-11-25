'use strict';
const { AppError } = require('../../errors/AppError');
const { toIso } = require('../../utils/dates');
const { validateBody } = require('../../http/validate');

const FEEDBACK_TYPES = Object.freeze(['helpful', 'not_helpful', 'already_done', 'not_relevant']);
const feedbackInput = (body) => validateBody(body, {
  feedbackType: { type: 'enum', values: FEEDBACK_TYPES, required: true },
  comment: { type: 'string', nullable: true, maxLength: 500 },
});
const toPublicFeedback = (f) => ({ feedbackType: f.feedbackType, comment: f.comment ?? null, createdAt: toIso(f.createdAt), updatedAt: toIso(f.updatedAt) });
const notFound = () => new AppError({ status: 404, code: 'not_found', message: 'Recommendation item not found' });

/** One feedback entry per user per recommended item (PUT = create or replace). Ownership: the run must belong to the caller and the item to that run. */
function createFeedbackService({ prisma }) {
  async function target(db, userId, runId, itemId) {
    const run = await db.recommendationRun.findFirst({ where: { id: runId, userId } });
    if (!run) throw notFound();
    const item = await db.recommendationItem.findFirst({ where: { id: itemId, recommendationRunId: runId } });
    if (!item) throw notFound();
    return item;
  }
  return {
    async put(userId, runId, itemId, input) {
      const comment = input.comment ? input.comment : null;
      return prisma.$transaction(async (tx) => {
        const item = await target(tx, userId, runId, itemId);
        const where = { userId, recommendationItemId: itemId };
        const existing = await tx.recommendationFeedback.findFirst({ where });
        if (existing) await tx.recommendationFeedback.updateMany({ where, data: { feedbackType: input.feedbackType, comment } });
        else await tx.recommendationFeedback.create({ data: { userId, recommendationRunId: runId, recommendationItemId: itemId, taskId: item.taskId ?? null, feedbackType: input.feedbackType, comment } });
        return toPublicFeedback(await tx.recommendationFeedback.findFirst({ where }));
      });
    },
    async remove(userId, runId, itemId) {
      await target(prisma, userId, runId, itemId);
      const res = await prisma.recommendationFeedback.deleteMany({ where: { userId, recommendationItemId: itemId } });
      if (res.count !== 1) throw new AppError({ status: 404, code: 'not_found', message: 'No feedback to remove' });
    },
    /** Map<itemId, publicFeedback> for a run (used by run detail so history shows saved feedback). */
    async forRun(db, userId, runId) {
      const rows = await db.recommendationFeedback.findMany({ where: { userId, recommendationRunId: runId } });
      return new Map(rows.map((f) => [f.recommendationItemId, toPublicFeedback(f)]));
    },
  };
}
module.exports = { createFeedbackService, feedbackInput, FEEDBACK_TYPES, toPublicFeedback };
