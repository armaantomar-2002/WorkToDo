'use strict';
// Installs deterministic stand-ins for native/optional dependencies (argon2, jose) so service logic can be unit-tested
// without them. The REAL argon2 / jose are exercised by the database/E2E tests on a machine where they are installed.
const Module = require('node:module');
const crypto = require('node:crypto');

function installStubs() {
  const original = Module._load;
  const stubs = {
    argon2: { argon2id: 2, hash: async (pw) => `stub$${crypto.createHash('sha256').update(pw).digest('hex')}`, verify: async (hash, pw) => hash === `stub$${crypto.createHash('sha256').update(pw).digest('hex')}` },
    jose: {
      SignJWT: class { constructor(p) { this.p = p; } setProtectedHeader() { return this; } setSubject(s) { this.s = s; return this; } setIssuer() { return this; } setAudience() { return this; } setIssuedAt() { return this; } setExpirationTime() { return this; } async sign() { return `stub.${Buffer.from(JSON.stringify({ sub: this.s, ...this.p })).toString('base64url')}.sig`; } },
      jwtVerify: async (t) => ({ payload: JSON.parse(Buffer.from(t.split('.')[1], 'base64url')) }),
    },
  };
  Module._load = function load(request, ...rest) { return Object.hasOwn(stubs, request) ? stubs[request] : original.call(this, request, ...rest); };
  return () => { Module._load = original; };
}
module.exports = { installStubs };
