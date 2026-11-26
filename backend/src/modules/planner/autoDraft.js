'use strict';
/**
 * After a successful change to tasks, dependencies, appointments, unavailable periods, focus timers or planning preferences, regenerate a DRAFT
 * (never an approved schedule) so the Recommendations page and the Planner both show the updated proposal. Best effort: a failure here never
 * fails the user's own request. The draft is built before the response is sent so the client's next fetch already sees it.
 */
function autoDraft({ scheduleService, match = () => true, onError = () => {} }) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !match(req)) return next();
    const end = res.end.bind(res); let done = false;
    res.end = (...args) => {
      if (done) return end(...args);
      done = true;
      const run = res.statusCode < 400 && req.auth && req.auth.userId ? scheduleService.refreshDraftIfNeeded(req.auth.userId).catch(onError) : Promise.resolve();
      run.finally(() => end(...args));
      return res;
    };
    return next();
  };
}
module.exports = { autoDraft };
