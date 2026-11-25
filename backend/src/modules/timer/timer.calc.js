'use strict';
// Pure elapsed-time maths for the focus timer. No I/O, no Date.now(): callers pass the instant to evaluate at.
// Source of truth = server timestamps (startedAt, endedAt, pause intervals). The browser never contributes elapsed time.

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/**
 * @param {{startedAt: Date, endedAt?: Date|null}} timer
 * @param {Array<{pausedAt: Date, resumedAt?: Date|null}>} pauses
 * @param {Date} at  evaluation instant (ignored once the timer has ended)
 * @returns {{focusedSeconds:number, pausedSeconds:number, wallSeconds:number}} whole seconds, floored; focused + paused <= wall
 */
function computeElapsed(timer, pauses, at) {
  const start = ms(timer.startedAt);
  const end = Math.max(start, ms(timer.endedAt ?? at));
  let pausedMs = 0;
  for (const p of pauses) {
    const from = Math.max(start, ms(p.pausedAt));
    const to = Math.min(end, p.resumedAt ? ms(p.resumedAt) : end); // an open pause runs until "now" / the end
    if (to > from) pausedMs += to - from;
  }
  const wallMs = end - start;
  const focusedMs = Math.max(0, wallMs - pausedMs);
  return { focusedSeconds: Math.floor(focusedMs / 1000), pausedSeconds: Math.floor(pausedMs / 1000), wallSeconds: Math.floor(wallMs / 1000) };
}

/** Allowed lifecycle transitions. Anything else is an invalid transition (409). */
const TRANSITIONS = Object.freeze({
  pause: { from: ['running'], to: 'paused' },
  resume: { from: ['paused'], to: 'running' },
  finish: { from: ['running', 'paused'], to: 'finished' },
  cancel: { from: ['running', 'paused'], to: 'cancelled' },
});
const ACTIVE_STATUSES = Object.freeze(['running', 'paused']);

module.exports = { computeElapsed, TRANSITIONS, ACTIVE_STATUSES };
