'use strict';
const express = require('express');

function rootRouter(config) {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.json({ service: config.service, name: config.name, message: 'WorkToDo backend is running', version: config.version, environment: config.nodeEnv });
  });
  return router;
}

module.exports = { rootRouter };
