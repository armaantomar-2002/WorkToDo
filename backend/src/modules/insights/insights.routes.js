'use strict';
const express = require('express');

function insightsRouter({ service, authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  router.get('/summary', async (req, res) => res.json(await service.summary(req.auth.userId, service.rangeQuery(req.query))));
  router.get('/tasks', async (req, res) => res.json(await service.tasks(req.auth.userId, service.rangeQuery(req.query))));
  router.get('/sessions', async (req, res) => res.json(await service.sessions(req.auth.userId, service.rangeQuery(req.query))));
  return router;
}
module.exports = { insightsRouter };
