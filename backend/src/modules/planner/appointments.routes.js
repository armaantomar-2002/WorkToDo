'use strict';
const express = require('express');
const { assertUuid } = require('../../http/validate');
const v = require('./appointments.validator');

/** Mounted at /api/v1/appointments (fixed appointments) and /api/v1/unavailable-periods. */
function appointmentsRouter({ service, authenticate }) {
  const r = express.Router(); r.use(authenticate);
  r.get('/', async (req, res) => res.json({ appointments: await service.list(req.auth.userId, v.range(req.query)) }));
  r.post('/', async (req, res) => res.status(201).json(await service.create(req.auth.userId, v.create(req.body))));
  r.get('/:id', async (req, res) => res.json({ appointment: await service.get(req.auth.userId, assertUuid(req.params.id)) }));
  r.patch('/:id', async (req, res) => res.json(await service.update(req.auth.userId, assertUuid(req.params.id), v.update(req.body))));
  r.post('/:id/cancel', async (req, res) => res.json(await service.cancel(req.auth.userId, assertUuid(req.params.id), v.cancel(req.body))));
  r.get('/:id/history', async (req, res) => res.json({ history: await service.history(req.auth.userId, assertUuid(req.params.id)) }));
  return r;
}
function unavailableRouter({ service, authenticate }) {
  const r = express.Router(); r.use(authenticate);
  r.get('/', async (req, res) => res.json({ periods: await service.listUnavailable(req.auth.userId, v.range(req.query)) }));
  r.post('/', async (req, res) => res.status(201).json({ period: await service.createUnavailable(req.auth.userId, v.unavailable(req.body)) }));
  r.delete('/:id', async (req, res) => { await service.removeUnavailable(req.auth.userId, assertUuid(req.params.id)); res.status(204).end(); });
  return r;
}
module.exports = { appointmentsRouter, unavailableRouter };
