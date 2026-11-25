'use strict';
const express = require('express');
const { assertUuid } = require('../../http/validate');
const v = require('./runs.validator');
const { feedbackInput } = require('./feedback.service');

/** Mounted at /api/v1/recommendations. Authenticated, persisted generation + history (the stateless POST / lives in routes/recommendations.js). */
function runsRouter({ service, feedback, authenticate }) {
  const router = express.Router();
  router.post('/runs', authenticate, async (req, res) => res.status(201).json(await service.create(req.auth.userId, v.runInput(req.body))));
  router.get('/history', authenticate, async (req, res) => res.json(await service.history(req.auth.userId, v.historyQuery(req.query))));
  router.get('/history/:id', authenticate, async (req, res) => res.json(await service.detail(req.auth.userId, assertUuid(req.params.id))));
  router.put('/runs/:runId/items/:itemId/feedback', authenticate, async (req, res) => res.json({ feedback: await feedback.put(req.auth.userId, assertUuid(req.params.runId), assertUuid(req.params.itemId), feedbackInput(req.body)) }));
  router.delete('/runs/:runId/items/:itemId/feedback', authenticate, async (req, res) => { await feedback.remove(req.auth.userId, assertUuid(req.params.runId), assertUuid(req.params.itemId)); res.status(204).end(); });
  return router;
}
module.exports = { runsRouter };
