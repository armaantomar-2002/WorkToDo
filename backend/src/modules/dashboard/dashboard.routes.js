'use strict';
const express = require('express');
function dashboardRouter({ service, authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  router.get('/summary', async (req, res) => res.json(await service.summary(req.auth.userId)));
  return router;
}
module.exports = { dashboardRouter };
