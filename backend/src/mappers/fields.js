'use strict';
// Single source of truth for the Node (camelCase) <-> Python (snake_case) field names. Verified against the Python schemas.

const SESSION_FIELDS = [
  ['localTime', 'session_timestamp'], ['availableTimeMinutes', 'available_time_minutes'], ['longestFreeSlotMinutes', 'longest_free_slot_minutes'],
  ['currentTimePeriod', 'current_time_period'], ['energyLevel', 'energy_level'], ['focusLevel', 'focus_level'],
];
const TASK_FIELDS = [
  ['taskId', 'task_id'], ['taskName', 'task_name'], ['startDate', 'start_date'], ['dueDate', 'due_date'], ['importance', 'importance'],
  ['goalContribution', 'goal_contribution'], ['consequenceOfDelay', 'consequence_of_delay'], ['complexity', 'complexity'],
  ['estimatedDurationMinutes', 'estimated_duration_minutes'], ['minimumSessionMinutes', 'minimum_session_minutes'], ['isSplittable', 'is_splittable'],
  ['preferredTime', 'preferred_time'], ['dependencyStatus', 'dependency_status'], ['status', 'status'],
];
const FACTOR_FIELDS = [
  ['urgency', 'urgency'], ['importance', 'importance'], ['goalContribution', 'goal_contribution'], ['feasibility', 'feasibility'],
  ['consequenceOfDelay', 'consequence_of_delay'], ['timingSuitability', 'timing_suitability'], ['energySuitability', 'energy_suitability'],
];
const RANKED_FIELDS = [
  ['rank', 'rank'], ['taskId', 'task_id'], ['taskName', 'task_name'], ['mlScore', 'ml_score'], ['category', 'category'],
  ['startableNow', 'startable_now'], ['reason', 'reason'], ...FACTOR_FIELDS,
];
const EXCLUDED_FIELDS = [['taskId', 'task_id'], ['exclusionReason', 'exclusion_reason']];
const SUMMARY_FIELDS = [['totalTasks', 'total_tasks'], ['eligible', 'eligible'], ['excluded', 'excluded'], ['returned', 'returned'], ['startableNow', 'startable_now']];

/** Python field name -> public name; used to translate field names in validation errors. */
const PY_TO_CAMEL = Object.freeze(Object.fromEntries(
  [...SESSION_FIELDS, ...TASK_FIELDS, ['topK', 'top_k'], ['session', 'session'], ['tasks', 'tasks']].map(([camel, py]) => [py, camel]),
));

module.exports = { SESSION_FIELDS, TASK_FIELDS, FACTOR_FIELDS, RANKED_FIELDS, EXCLUDED_FIELDS, SUMMARY_FIELDS, PY_TO_CAMEL };
