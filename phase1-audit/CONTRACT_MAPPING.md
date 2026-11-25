# WorkToDo contract mapping (verified against the actual code, not assumed)

Sources: `worktodo_service/app/schemas.py`, `worktodo_features.py` (validate_session / validate_tasks, maps), `backend/src/mappers/fields.js`,
`backend/src/validators/recommendationRequest.js`, `backend/src/validators/mlResponse.js`. "Proposed" columns are design proposals for Phase 3, not existing code.

## 1. Task
| PostgreSQL (proposed) | Node API (existing validator) | Python request | Required by Python? | Type / allowed values (verified) | Frontend |
|---|---|---|---|---|---|
| id (uuid) | taskId | task_id | yes | non-empty string or safe integer; must be unique per request | hidden |
| taskName (NOT NULL) | taskName | task_name | no (nullable) | string | Task name |
| description (proposed, DB only) | **not sent** | – | – | text | Details |
| startDate (DATE, null) | startDate | start_date | no; null = no restriction | local date `YYYY-MM-DD` or `YYYY-MM-DD HH:mm[:ss]`, no Z/offset, no fractions | Start date |
| dueDate (DATE, null) | dueDate | due_date | no; null = no deadline (urgency 10) | same as above | Due date |
| importance (enum) | importance | importance | yes | Critical, High, Medium, Low | badge |
| goalContribution (enum) | goalContribution | goal_contribution | yes | Essential, High, Medium, Low, No linked goal | select |
| consequenceOfDelay (enum) | consequenceOfDelay | consequence_of_delay | yes | Major, Significant, Moderate, Minor, None, No consequence (both "None" forms score 0; store one canonical) | select |
| complexity (enum) | complexity | complexity | yes | Simple, Moderate, Complex | select |
| estimatedDurationMinutes (int > 0) | estimatedDurationMinutes | estimated_duration_minutes | yes | JSON number; Python rejects <= 0 | minutes |
| minimumSessionMinutes (int, null) | minimumSessionMinutes | minimum_session_minutes | only if isSplittable | > 0 and <= duration when splittable; ignored otherwise | shown only if splittable |
| isSplittable (bool) | isSplittable | is_splittable | yes | strict boolean (Node rejects strings/0/1) | checkbox |
| preferredTime (enum) | preferredTime | preferred_time | yes | Morning, Afternoon, Evening, Night, Anytime | select |
| dependencyStatus (enum, default "No dependency") | dependencyStatus | dependency_status | no; null = none | No dependency, Ready, Blocked (other strings rejected) | select |
| status (enum) | status | status | yes | Pending, In Progress (eligible); Completed, Cancelled (excluded "Task not active"); any other string is excluded too | badge |
| createdAt/updatedAt/completedAt (timestamptz) | – | not sent | – | UTC instants | – |
| deletedAt (proposed, soft delete) | – | tasks with deletedAt are never sent | – | – | – |

## 2. Focus session / session context
| PostgreSQL (proposed) | Node API | Python request | Required? | Type / allowed values | Frontend |
|---|---|---|---|---|---|
| sessionLocalTime (wall-clock, see section 5) | localTime | session_timestamp | yes | `YYYY-MM-DD HH:mm[:ss]` (space or `T`), valid calendar, no Z/offset, no fractions, date-only rejected by Node | datetime-local |
| availableTimeMinutes | availableTimeMinutes | available_time_minutes | yes | JSON number >= 0 (0 allowed: nothing startable) | minutes |
| longestFreeSlotMinutes | longestFreeSlotMinutes | longest_free_slot_minutes | yes | number >= 0; engine uses min(slot, available); proposal: Node session endpoints also require slot <= available (new Node rule, Python unchanged) | minutes |
| currentTimePeriod | currentTimePeriod | current_time_period | yes | Morning, Afternoon, Evening, Night ("Anytime" invalid here) | select |
| energyLevel | energyLevel | energy_level | yes | Low, Medium, High | select |
| focusLevel | focusLevel | focus_level | yes | Low, Medium, High | select |

## 3. Recommendation response (Python -> Node -> DB -> frontend)
| Python response | Node response (existing) | PostgreSQL (proposed) | Notes |
|---|---|---|---|
| ranked[].rank | rank | RecommendationItem.rank (unique per run) | sequential 1..n (validated) |
| ranked[].task_id | taskId | taskId (nullable FK, ON DELETE SET NULL) + taskNameSnapshot | history must survive task changes |
| ranked[].task_name | taskName | taskNameSnapshot | may be null |
| ranked[].ml_score | mlScore | mlScore DOUBLE PRECISION | stored unrounded; display 2 decimals only in UI |
| ranked[].category | category | category TEXT | "Do now" / "Do next" / "Schedule later"; keep as text (Python owns the set; Node already validates it) |
| ranked[].startable_now | startableNow | startableNow BOOLEAN | |
| ranked[].reason | reason | reason TEXT | explanation wording is Python's; never edited |
| ranked[].urgency ... energy_suitability (7 factors, 0-100) | urgency, importance, goalContribution, feasibility, consequenceOfDelay, timingSuitability, energySuitability | 7 DOUBLE PRECISION columns | `importance` here is a SCORE (20-100), not the label |
| excluded[].task_id / exclusion_reason | taskId / exclusionReason | RecommendationExclusion.taskId (nullable FK) + snapshot / exclusionReason TEXT | reasons seen: "Task not active", "Blocked dependency", "Start date in future" |
| summary.total_tasks / eligible / excluded / returned / startable_now | totalTasks / eligible / excluded / returned / startableNow | RecommendationRun.totalTasks / eligibleTasks / excludedTasks / returnedTasks (+ proposed startableNow) | Node already checks the counts are consistent |
| top_k | topK | RecommendationRun.topK (proposed, nullable) | items saved = returned items only |

## 4. Errors (existing behavior the frontend must handle)
Node envelope: `{error, message, errors?:[{field,message,taskIds?}], errorId?}`. Codes: `validation_error` 422, `malformed_json` 400, `payload_too_large` 413, `ml_contract_error` 502, `ml_service_error` 502,
`ml_service_unavailable` 503, `ml_timeout` 504, `ml_invalid_response` 502, `internal_error` 500, `not_found` 404.

## 5. Date/time strategy (proposed)
- Task `startDate`/`dueDate`: PostgreSQL `DATE`, exposed as `YYYY-MM-DD` strings (no instants, no timezone). Prisma returns a JS Date at UTC midnight: format it with UTC getters, never `toISOString().slice` after a local conversion.
- Session wall-clock: stored as `TIMESTAMP(0)` WITHOUT time zone holding the wall-clock digits (built with `Date.UTC`, read with UTC getters) inside ONE repository helper; the API always returns the original `YYYY-MM-DD HH:mm:ss` string, never an ISO `Z` value. This preserves the existing "localTime is passed through unchanged" contract.
- Audit instants (`createdAt`, `completedAt`, token expiries): `TIMESTAMPTZ`.
- Day bucketing for Insights/greeting uses `UserPreferences.timeZone` (proposed new IANA field, validated); it is never sent to Python.


## Addendum (correction pass): dependencies, focus timer, feedback
| Concept | API | DB | Notes |
|---|---|---|---|
| dependencyStatus | `Task.dependencyStatus` (read-only, derived) | `Task.dependencyStatus` + `TaskDependency(taskId, dependsOnTaskId)` | Sent to Python as `dependency_status` with exactly `No dependency` / `Ready` / `Blocked`; derived per run from live edges (not trusted from the stored column) |
| prerequisite edge | `POST/DELETE /tasks/:id/dependencies` | `TaskDependency` (composite FKs to `Task(id,userId)`, CHECK not self, UNIQUE edge) | cycle check in Node under a per-user row lock |
| focus timer | `/focus-timers` (start, active, pause, resume, finish, cancel, history) | `FocusTimer` + `FocusTimerPause` (partial unique indexes: one active timer per user, one open pause per timer) | elapsed = server timestamps minus pause intervals; planned (`plannedDurationMinutes`) and actual (`actualFocusedSeconds`) are separate columns |
| feedback | `PUT/DELETE /recommendations/runs/:runId/items/:itemId/feedback`; run detail items carry `itemId` and `feedback` | `RecommendationFeedback` (UNIQUE user+item; composite FKs to `RecommendationRun(id,userId)` and `RecommendationItem(id,runId)`) | one entry per user per recommended item |
