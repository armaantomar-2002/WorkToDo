'use strict';
const express = require('express');
const { assertUuid } = require('../../http/validate');
const v = require('./schedule.validator');

/** /tasks/:id/postpone + /tasks/:id/postponements (mounted at /tasks before the main tasks router) */
function postponeRouter({ service, authenticate }) {
  const r = express.Router(); r.use(authenticate);
  r.post('/:id/postpone', async (req, res) => res.status(201).json(await service.postpone(req.auth.userId, assertUuid(req.params.id), v.postpone(req.body))));
  r.get('/:id/postponements', async (req, res) => res.json(await service.history(req.auth.userId, assertUuid(req.params.id))));
  return r;
}
/** /calendar */
function calendarRouter({ service, authenticate }) {
  const r = express.Router(); r.use(authenticate);
  r.get('/', async (req, res) => res.json(await service.range(req.auth.userId, v.calendarQuery(req.query))));
  return r;
}
module.exports = { postponeRouter, calendarRouter };
