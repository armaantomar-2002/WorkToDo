'use strict';
const express = require('express');

function recommendationsRouter(recommendationService) {
  const router = express.Router();
  // Express 5 forwards rejected promises to the error handler, so no try/catch is needed here.
  router.post('/api/v1/recommendations', async (req, res) => {
    res.json(await recommendationService.recommend(req.body));
  });
  return router;
}

module.exports = { recommendationsRouter };
