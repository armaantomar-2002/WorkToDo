'use strict';
const { validateBody } = require('../../http/validate');
const { assertPasswordPolicy } = require('../../auth/password');

const rawPassword = { type: 'string', required: true, trim: false, minLength: 1, maxLength: 128 }; // policy is checked separately

const registerInput = (b) => {
  const d = validateBody(b, { fullName: { type: 'string', required: true, minLength: 1, maxLength: 120 }, email: { type: 'email', required: true }, password: rawPassword, rememberMe: { type: 'boolean' } });
  assertPasswordPolicy(d.password);
  return d;
};
const loginInput = (b) => validateBody(b, { email: { type: 'email', required: true }, password: rawPassword, rememberMe: { type: 'boolean' } });
const changePasswordInput = (b) => {
  const d = validateBody(b, { currentPassword: rawPassword, newPassword: rawPassword });
  assertPasswordPolicy(d.newPassword, 'newPassword');
  return d;
};
const forgotPasswordInput = (b) => validateBody(b, { email: { type: 'email', required: true } });
const resetPasswordInput = (b) => {
  const d = validateBody(b, { token: { type: 'string', required: true, minLength: 20, maxLength: 200 }, newPassword: rawPassword });
  assertPasswordPolicy(d.newPassword, 'newPassword');
  return d;
};
module.exports = { registerInput, loginInput, changePasswordInput, forgotPasswordInput, resetPasswordInput };
