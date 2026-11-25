'use strict';

/** Catch-all for requests that matched no route. Must be registered after all routes. */
function notFound(req, res) {
  res.status(404).json({ error: 'not_found', message: `Route ${req.method} ${req.path} not found` });
}

module.exports = { notFound };
