'use strict';
const express = require('express');
const { assertUuid } = require('../../http/validate');
const v = require('./schedule.validator');

/** Mounted at /api/v1/schedules. Order matters: fixed paths before /:id. */
function scheduleRouter({ service, authenticate }) {
  const r = express.Router(); r.use(authenticate);
  const uid = (req) => req.auth.userId;
  r.get('/', async (req, res) => res.json({ schedules: await service.list(uid(req)) }));
  r.get('/active', async (req, res) => res.json({ schedule: await service.getOpen(uid(req), 'approved') }));
  r.get('/draft', async (req, res) => res.json({ schedule: await service.getOpen(uid(req), 'draft') }));
  r.post('/drafts', async (req, res) => res.status(201).json(await service.generateDraft(uid(req), v.generate(req.body))));
  r.get('/:id', async (req, res) => res.json(await service.get(uid(req), assertUuid(req.params.id))));
  r.get('/:id/diff', async (req, res) => res.json(await service.diff(uid(req), assertUuid(req.params.id))));
  r.post('/:id/approve', async (req, res) => res.json(await service.approve(uid(req), assertUuid(req.params.id), v.revisionOnly(req.body))));
  r.post('/:id/reject', async (req, res) => { v.revisionOnly(req.body); res.json(await service.reject(uid(req), assertUuid(req.params.id))); });
  r.patch('/:id/blocks/:blockId', async (req, res) => { const b = v.move(req.body); res.json(await service.moveBlock(uid(req), assertUuid(req.params.id), assertUuid(req.params.blockId), b)); });
  r.delete('/:id/blocks/:blockId', async (req, res) => res.json(await service.removeBlock(uid(req), assertUuid(req.params.id), assertUuid(req.params.blockId), v.revisionQuery(req.query))));
  r.post('/:id/blocks/:blockId/skip', async (req, res) => { v.revisionOnly(req.body); res.json(await service.skipBlock(uid(req), assertUuid(req.params.id), assertUuid(req.params.blockId))); });
  r.post('/:id/breaks', async (req, res) => res.status(201).json(await service.addBreak(uid(req), assertUuid(req.params.id), v.addBreak(req.body))));
  r.post('/:id/breaks/:blockId/accept', async (req, res) => res.json(await service.acceptBreak(uid(req), assertUuid(req.params.id), assertUuid(req.params.blockId), v.revisionOnly(req.body))));
  return r;
}
module.exports = { scheduleRouter };
