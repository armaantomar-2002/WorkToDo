'use strict';

/**
 * Operational error with a client-safe status, code and message. The message must be a fixed, safe string (never upstream
 * text). `logContext` and `cause` are for server-side logs only and are never sent to clients.
 */
class AppError extends Error {
  constructor({ status, code, message, errors, logContext, cause }) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
    this.code = code;
    this.errors = errors;
    this.logContext = logContext;
  }
}

module.exports = { AppError };
