'use strict';
const express = require('express');
const { assertUuid } = require('../../http/validate');
const v = require('./tasks.validator');

function tasksRouter({ service, dependencies, authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  router.get('/', async (req, res) => res.json(await service.list(req.auth.userId, v.listQuery(req.query))));
  router.post('/', async (req, res) => res.status(201).json({ task: await service.create(req.auth.userId, v.createInput(req.body)) }));
  router.get('/:id', async (req, res) => res.json({ task: await service.get(req.auth.userId, assertUuid(req.params.id)) }));
  router.patch('/:id', async (req, res) => res.json({ task: await service.update(req.auth.userId, assertUuid(req.params.id), req.body) }));
  router.patch('/:id/status', async (req, res) => res.json({ task: await service.setStatus(req.auth.userId, assertUuid(req.params.id), v.statusInput(req.body)) }));
  router.get('/:id/dependencies', async (req, res) => res.json(await dependencies.list(req.auth.userId, assertUuid(req.params.id))));
  router.post('/:id/dependencies', async (req, res) => {
    const { dependsOnTaskId } = v.dependencyInput(req.body);
    res.status(201).json(await dependencies.add(req.auth.userId, assertUuid(req.params.id), dependsOnTaskId));
  });
  router.delete('/:id/dependencies/:prerequisiteId', async (req, res) => res.json(await dependencies.remove(req.auth.userId, assertUuid(req.params.id), assertUuid(req.params.prerequisiteId))));
  router.delete('/:id', async (req, res) => { await service.remove(req.auth.userId, assertUuid(req.params.id)); res.status(204).end(); });
  return router;
}
module.exports = { tasksRouter };
