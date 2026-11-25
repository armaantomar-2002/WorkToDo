'use strict';
const { validateRecommendationRequest } = require('../validators/recommendationRequest');
const { validateMlResponse } = require('../validators/mlResponse');
const { toPythonRequest, toPublicResponse } = require('../mappers/recommendationMapper');

/** Orchestration only: validate -> map -> call Python -> verify contract -> map back. All scoring/ranking stays in Python. */
function createRecommendationService({ mlClient }) {
  return {
    async recommend(body) {
      const request = validateRecommendationRequest(body);
      const raw = await mlClient.recommend(toPythonRequest(request));
      validateMlResponse(raw, { requestedTasks: request.tasks.length, topK: request.topK });
      return toPublicResponse(raw);
    },
  };
}

module.exports = { createRecommendationService };
