'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { AppError } = require('../../errors/AppError');
const { assertUuid } = require('../../http/validate');
const { setRefreshCookie, clearRefreshCookie, readRefreshCookie } = require('../../http/cookies');
const v = require('./auth.validator');

function authRouter({ service, usersService, config, authenticate }) {
  const router = express.Router();
  const limiter = rateLimit.rateLimit({
    windowMs: config.auth.rateLimitWindowMs, limit: config.auth.rateLimitMax, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res, next) => next(new AppError({ status: 429, code: 'rate_limited', message: 'Too many attempts. Please wait and try again.' })),
  });
  const ua = (req) => ({ userAgent: req.headers['user-agent'] });
  const sendSession = (res, status, result) => {
    setRefreshCookie(res, config.cookies, result.refreshToken, result.refreshMaxAgeSeconds);
    res.status(status).json({ user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn });
  };

  router.post('/register', limiter, async (req, res) => sendSession(res, 201, await service.register(v.registerInput(req.body), ua(req))));
  router.post('/login', limiter, async (req, res) => sendSession(res, 200, await service.login(v.loginInput(req.body), ua(req))));

  router.post('/refresh', async (req, res, next) => {
    try {
      sendSession(res, 200, await service.refresh(readRefreshCookie(req, config.cookies), ua(req)));
    } catch (err) {
      if (err instanceof AppError && err.code === 'invalid_refresh_token') clearRefreshCookie(res, config.cookies);
      next(err);
    }
  });

  router.post('/logout', async (req, res) => {
    await service.logout({ refreshToken: readRefreshCookie(req, config.cookies) });
    clearRefreshCookie(res, config.cookies);
    res.json({ ok: true });
  });

  router.get('/me', authenticate, async (req, res) => {
    res.json({ user: await usersService.getMe(req.auth.userId) });
  });

  router.post('/change-password', limiter, authenticate, async (req, res) => {
    await service.changePassword(req.auth.userId, req.auth.familyId, v.changePasswordInput(req.body));
    res.json({ ok: true });
  });
  router.post('/forgot-password', limiter, async (req, res) => {
    await service.forgotPassword(v.forgotPasswordInput(req.body));
    res.status(202).json({ ok: true, message: 'If an account exists for that email, a reset link has been prepared.' });
  });
  router.post('/reset-password', limiter, async (req, res) => {
    await service.resetPassword(v.resetPasswordInput(req.body));
    res.json({ ok: true });
  });

  router.get('/sessions', authenticate, async (req, res) => res.json({ sessions: await service.listSessions(req.auth.userId, req.auth.familyId) }));
  router.delete('/sessions', authenticate, async (req, res) => res.json(await service.revokeOtherSessions(req.auth.userId, req.auth.familyId)));
  router.delete('/sessions/:id', authenticate, async (req, res) => {
    const out = await service.revokeSession(req.auth.userId, assertUuid(req.params.id));
    if (out.familyId === req.auth.familyId) clearRefreshCookie(res, config.cookies);
    res.json({ ok: true, revokedCurrent: out.familyId === req.auth.familyId });
  });
  return router;
}
module.exports = { authRouter };
