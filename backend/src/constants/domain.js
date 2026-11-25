'use strict';
// Domain values. Identical to the Python ML contract and to the DB CHECK constraints (migration.sql). Single source of truth for Node.

const IMPORTANCE = Object.freeze(['Critical', 'High', 'Medium', 'Low']);
const IMPORTANCE_RANK = Object.freeze({ Critical: 1, High: 2, Medium: 3, Low: 4 }); // 1 = most important (sort key)
const GOAL_CONTRIBUTION = Object.freeze(['Essential', 'High', 'Medium', 'Low', 'No linked goal']);
const CONSEQUENCE_OF_DELAY = Object.freeze(['Major', 'Significant', 'Moderate', 'Minor', 'None']);
const COMPLEXITY = Object.freeze(['Simple', 'Moderate', 'Complex']);
const PREFERRED_TIME = Object.freeze(['Morning', 'Afternoon', 'Evening', 'Night', 'Anytime']);
const DEPENDENCY_STATUS = Object.freeze(['No dependency', 'Ready', 'Blocked']);
const TASK_STATUS = Object.freeze(['Pending', 'In Progress', 'Completed', 'Cancelled']);
const TIME_PERIOD = Object.freeze(['Morning', 'Afternoon', 'Evening', 'Night']);
const LEVEL = Object.freeze(['Low', 'Medium', 'High']);
const THEME = Object.freeze(['light', 'dark']);
const NOTIFICATION = Object.freeze(['all', 'important', 'none']);

module.exports = {
  IMPORTANCE, IMPORTANCE_RANK, GOAL_CONTRIBUTION, CONSEQUENCE_OF_DELAY, COMPLEXITY, PREFERRED_TIME, DEPENDENCY_STATUS,
  TASK_STATUS, TIME_PERIOD, LEVEL, THEME, NOTIFICATION,
};
