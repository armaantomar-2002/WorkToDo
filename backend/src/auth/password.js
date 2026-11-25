'use strict';
const { AppError } = require('../errors/AppError');

// Argon2id with OWASP-recommended minimum parameters (19 MiB, 2 iterations, 1 lane). `argon2` is loaded lazily so that
// modules that only need the policy check can be unit-tested without the native dependency.
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

/** @returns {string|null} a problem description, or null when the password satisfies the policy */
function passwordProblem(password) {
  if (typeof password !== 'string') return 'must be a string';
  if (password.length < MIN_LENGTH) return `must be at least ${MIN_LENGTH} characters`;
  if (password.length > MAX_LENGTH) return `must be at most ${MAX_LENGTH} characters`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'must contain at least one letter and one number';
  return null;
}
function assertPasswordPolicy(password, field = 'password') {
  const problem = passwordProblem(password);
  if (problem) throw new AppError({ status: 422, code: 'validation_error', message: 'Request validation failed', errors: [{ field, message: problem }] });
}

let argon;
const lib = () => (argon ??= require('argon2'));
const hashPassword = (password) => lib().hash(password, { type: lib().argon2id, ...ARGON_OPTIONS });
async function verifyPassword(hash, password) {
  try { return await lib().verify(hash, password); } catch { return false; }
}

let dummy;
/** Verifies against a throw-away hash so "unknown email" costs about the same time as "wrong password". */
async function burnPasswordCheck(password) {
  dummy ??= await hashPassword('worktodo-dummy-password-1');
  await verifyPassword(dummy, password);
}

module.exports = { passwordProblem, assertPasswordPolicy, hashPassword, verifyPassword, burnPasswordCheck, MIN_LENGTH, MAX_LENGTH };
