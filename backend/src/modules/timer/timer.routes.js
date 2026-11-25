'use strict';
const express = require('express');
const { assertUuid } = require('../../http/validate');
const v = require('./timer.validator');

/** Mounted at /api/v1/focus-timers. */
function timerRouter({ service, authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  router.post('/', async (req, res) => res.status(201).json({ timer: await service.start(req.auth.userId, v.startInput(req.body)) }));
  router.get('/active', async (req, res) => res.json({ timer: await service.active(req.auth.userId) }));
  router.get('/', async (req, res) => res.json(await service.history(req.auth.userId, v.historyQuery(req.query))));
  router.get('/:id', async (req, res) => res.json({ timer: await service.get(req.auth.userId, assertUuid(req.params.id)) }));
  router.post('/:id/pause', async (req, res) => { v.noBody(req.body); res.json({ timer: await service.pause(req.auth.userId, assertUuid(req.params.id)) }); });
  router.post('/:id/resume', async (req, res) => { v.noBody(req.body); res.json({ timer: await service.resume(req.auth.userId, assertUuid(req.params.id)) }); });
  router.post('/:id/finish', async (req, res) => res.json({ timer: await service.finish(req.auth.userId, assertUuid(req.params.id), v.finishInput(req.body)) }));
  router.post('/:id/cancel', async (req, res) => { v.noBody(req.body); res.json({ timer: await service.cancel(req.auth.userId, assertUuid(req.params.id)) }); });
  return router;
}
module.exports = { timerRouter };
