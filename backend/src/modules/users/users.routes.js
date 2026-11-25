'use strict';
const express = require('express');
const v = require('./users.validator');

function usersRouter({ service, authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  router.get('/me', async (req, res) => res.json({ user: await service.getMe(req.auth.userId) }));
  router.patch('/me', async (req, res) => res.json({ user: await service.updateMe(req.auth.userId, v.profileInput(req.body)) }));
  router.get('/preferences', async (req, res) => res.json({ preferences: await service.getPreferences(req.auth.userId) }));
  router.patch('/preferences', async (req, res) => res.json({ preferences: await service.updatePreferences(req.auth.userId, v.preferencesInput(req.body)) }));
  return router;
}
module.exports = { usersRouter };
