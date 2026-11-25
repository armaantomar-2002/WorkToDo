'use strict';
const express = require('express');
const { assertUuid } = require('../../http/validate');
const v = require('./sessions.validator');

function sessionsRouter({ service, authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  router.get('/', async (req, res) => res.json(await service.list(req.auth.userId, v.listQuery(req.query))));
  router.post('/', async (req, res) => res.status(201).json({ session: await service.create(req.auth.userId, v.createInput(req.body)) }));
  router.get('/:id', async (req, res) => res.json({ session: await service.get(req.auth.userId, assertUuid(req.params.id)) }));
  router.patch('/:id', async (req, res) => res.json({ session: await service.update(req.auth.userId, assertUuid(req.params.id), req.body) }));
  router.delete('/:id', async (req, res) => { await service.remove(req.auth.userId, assertUuid(req.params.id)); res.status(204).end(); });
  return router;
}
module.exports = { sessionsRouter };
