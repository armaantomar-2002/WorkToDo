'use strict';
const crypto = require('node:crypto');
const { STATUS_CODES } = require('node:http');
const { AppError } = require('../errors/AppError');

// Errors raised by express.json()/body-parser carry a `type`; map them to safe, client-facing responses.
const BODY_PARSER_ERRORS = {
  'entity.parse.failed': { status: 400, error: 'malformed_json', message: 'Request body is not valid JSON' },
  'entity.too.large': { status: 413, error: 'payload_too_large', message: 'Request body is too large' },
  'charset.unsupported': { status: 415, error: 'unsupported_charset', message: 'Unsupported charset' },
  'encoding.unsupported': { status: 415, error: 'unsupported_encoding', message: 'Unsupported content encoding' },
  'request.aborted': { status: 400, error: 'request_aborted', message: 'Request was aborted' },
};

function statusOf(err) {
  const status = err && (err.status ?? err.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

/**
 * Centralized error handler (4-argument signature is required by Express). Express 5 forwards both thrown errors and
 * rejected promises from handlers here. 5xx details reach clients only when config.exposeErrorDetails is true (NODE_ENV=development); stacks are always logged server-side.
 */
function errorHandler(config, logger = console) {
  return function handleError(err, req, res, next) {
    if (res.headersSent) return next(err);

    // Typed operational errors (e.g. ML service failures): fixed safe message + code. instanceof only, so system errors
    // that merely carry a `code` property (ECONNREFUSED, ...) can never be mistaken for one. Details go to the log only.
    if (err instanceof AppError) {
      const body = { error: err.code, message: err.message };
      if (err.errors) body.errors = err.errors;
      if (err.status >= 500) {
        body.errorId = crypto.randomBytes(6).toString('hex');
        logger.error(`[${body.errorId}] ${req.method} ${req.path} ${err.code}`, err.logContext || {}, ...(err.cause ? [err.cause] : []));
      }
      return res.status(err.status).json(body);
    }

    const known = BODY_PARSER_ERRORS[err && err.type];
    const status = known ? known.status : statusOf(err);

    if (status >= 500) {
      const errorId = crypto.randomBytes(6).toString('hex');
      logger.error(`[${errorId}] ${req.method} ${req.path}`, err);
      const raw = typeof err === 'string' ? err : err && err.message;
      const expose = config.exposeErrorDetails === true; // fail-closed: anything but an explicit true hides details
      const body = { error: 'internal_error', message: expose && raw ? raw : 'Unexpected server error', errorId };
      if (expose && err && err.stack) body.stack = err.stack;
      return res.status(status).json(body);
    }

    if (known) return res.status(status).json({ error: known.error, message: known.message });
    const message = err && err.expose && err.message ? err.message : STATUS_CODES[status];
    return res.status(status).json({ error: status === 404 ? 'not_found' : 'http_error', message });
  };
}

module.exports = { errorHandler };
