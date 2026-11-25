# API reference (base `/api/v1`)

All DB-backed routes require `Authorization: Bearer <access token>` except the public auth routes. State-changing requests must send `X-Requested-With: WorkToDo` (CSRF guard). Errors: `{ "error": "<code>", "message": "...", "errors": [{ "field", "message" }] }`.

| Method | Path | Purpose |
|---|---|---|
| POST | /auth/register, /auth/login | Create account / sign in (returns user + access token; sets refresh cookie) |
| POST | /auth/refresh | Rotate refresh cookie, new access token (`401 refresh_race` if another tab just rotated) |
| POST | /auth/logout | Revoke this session family, clear cookie |
| GET | /auth/me | Current user |
| POST | /auth/change-password | Requires current password; signs out other devices |
| POST | /auth/forgot-password, /auth/reset-password | Non-enumerating reset flow (see EMAIL.md) |
| GET / DELETE | /auth/sessions, /auth/sessions/:id | List devices / revoke one or all others |
| GET / PATCH | /users/me | Profile (email change needs `currentPassword`) |
| GET / PATCH | /users/preferences | Energy, focus, period, theme, notification, time zone |
| GET / POST | /tasks | List (search, status, importance, sort, page) / create. `dependencyStatus` is **read-only, derived** from prerequisites; sending it is a 422 |
| GET / PATCH / DELETE | /tasks/:id | Read / update / soft-delete |
| PATCH | /tasks/:id/status | Complete, reopen, cancel |
| GET / POST | /sessions | Saved focus sessions |
| GET / PATCH / DELETE | /sessions/:id | |
| POST | /recommendations/runs | Run ML on the user's own tasks (body: session id or inline session); persists the run |
| GET | /recommendations/history, /history/:id | Past runs, reproduced from stored snapshots; detail items carry `itemId` and `feedback` |
| GET / POST | /tasks/:id/dependencies | List prerequisites + dependents / add `{ "dependsOnTaskId" }` (409 on self, cycle, duplicate, >20; 404 for another user's task) |
| DELETE | /tasks/:id/dependencies/:dependsOnTaskId | Unlink; dependent status is recomputed |
| POST | /focus-timers | Start a timer `{ taskId?, plannedDurationMinutes, sessionId? }`. 409 `timer_already_active` if the user has a running/paused one |
| GET | /focus-timers/active | Active timer with server-computed `elapsedSeconds` / `remainingSeconds` (or `null`) |
| GET | /focus-timers, /focus-timers/:id | History (paged) / one timer incl. pause intervals |
| POST | /focus-timers/:id/pause, /resume, /finish, /cancel | Lifecycle. Invalid transition → 409 `invalid_transition`. `finish` accepts `{ "completeTask": true }`. No client timestamps are accepted |
| PUT / DELETE | /recommendations/runs/:runId/items/:itemId/feedback | Upsert / remove feedback `{ type: helpful|not_helpful|already_done|not_relevant, comment? ≤500 }` (one per user per item) |
| GET | /dashboard/summary | Counts, completion %, today's recommendation (latest run) |
| GET | /insights/summary, /insights/tasks, /insights/sessions | `?range=7|30|90` |
| POST | /recommendations | Legacy stateless endpoint (unchanged; disabled in production with a DB) |

`GET /health` (outside `/api/v1`) reports process info only.

## Dependency status contract
Sent to Python as `dependency_status`, exactly `No dependency` | `Ready` | `Blocked`. Derived per run from live edges: no live prerequisites → `No dependency`; any prerequisite Pending/In Progress → `Blocked`; otherwise (Completed, Cancelled or deleted) → `Ready`. The Python rules are unchanged.

## Timer semantics
`elapsed = (end or now) − startedAt − Σ pause intervals`, computed on the server from database timestamps, floored to whole seconds. Finish/cancel freeze `actualFocusedSeconds` and `totalPausedSeconds`. Planned (`plannedDurationMinutes`) and actual are separate fields. Dashboard/Insights "focus time" is actual finished-timer time.


## Planner endpoints (all require auth; every row is scoped to the caller, foreign ids return 404)
Dates are `YYYY-MM-DD`, wall-clock times are `YYYY-MM-DDTHH:mm` in the user's own time zone (default `Asia/Kolkata`). Errors use `{error, message, errors?[]}`.

| Method & path | Purpose | Notable errors |
|---|---|---|
| `GET /calendar?from&to` | Read model for day/week/month: days (working window, free/planned/actual minutes, counts), appointments, unavailable periods, approved and draft blocks, deadlines, completions, actual sessions. Range ≤ 43 days. | 422 |
| `GET /appointments?from&to&status` · `POST /appointments` · `GET/PATCH /appointments/:id` | List / create / read / edit. PATCH accepts `revision` (optimistic). Response includes `impact` (affected approved/draft sessions). | 409 `appointment_conflict`, 409 `stale_revision`, 409 `invalid_transition` (cancelled), 422 |
| `POST /appointments/:id/cancel` · `GET /appointments/:id/history` | Cancel (time is released, record kept) / created·updated·rescheduled·cancelled history. | 409 `invalid_transition` |
| `GET/POST /unavailable-periods` · `DELETE /unavailable-periods/:id` | Blocks of time nothing may be scheduled in. | 422 |
| `GET /schedules` | Version history (newest first). | |
| `GET /schedules/active` · `GET /schedules/draft` · `GET /schedules/:id` | Full view: blocks, problems, dynamic `unscheduled` with reasons, `stale`, `needsRecalculation`, task summaries, free slots, working hours. `active`/`draft` return `{schedule:null}` when none. | |
| `POST /schedules/drafts` `{mode?: minimal\|fresh\|clone, useMl?, replace?}` | Generate a draft. `minimal` keeps valid future approved blocks; `fresh` plans everything; `clone` copies the approved plan for manual editing (no ML call). One ML call per draft; on failure a transparent rule-based fallback is used (`orderSource:"fallback"`, `notes.ml`). | 409 `draft_exists` (send `replace:true`) |
| `GET /schedules/:id/diff` | Added/removed upcoming blocks vs the approved schedule. | |
| `POST /schedules/:id/approve` `{revision?}` · `POST /schedules/:id/reject` | Approve (validates everything again, supersedes the old approved version atomically) / reject. Rejecting never touches the approved schedule. | 409 `stale_revision`, `draft_stale`, `invalid_transition`, `concurrent_approval`; 422 `schedule_invalid` |
| `PATCH /schedules/:id/blocks/:blockId` `{start, revision?, preview?}` | Move a draft session/break (duration is kept). `preview:true` validates without saving. | 409 `schedule_conflict` (nothing saved), `stale_revision`, `invalid_transition` (not a draft) |
| `DELETE /schedules/:id/blocks/:blockId?revision=` | Remove a draft block. | |
| `POST /schedules/:id/breaks` `{start,end,revision?,replan?}` · `POST /schedules/:id/breaks/:blockId/accept` | Manual break / accept a suggested break. Overlapping a session needs `replan:true`, which re-plans only the displaced tasks. | 409 `break_conflict`, `schedule_conflict` |
| `POST /schedules/:id/blocks/:blockId/skip` | Mark a session of the approved schedule skipped (history kept; plan not rewritten). | 409 `invalid_transition` |
| `POST /tasks/:id/postpone` `{days?=1, reason?, confirm?}` · `GET /tasks/:id/postponements` | Postpone (sets `postponedUntil`, never changes `dueDate`). Past the deadline needs `confirm:true`. | 409 `confirmation_required`, `invalid_transition` |
| `GET /users/preferences` · `PATCH /users/preferences` | Now also: `workDayStart`, `workDayEnd` (`24:00` allowed), `workDays` (0=Sun…6=Sat), `breaksEnabled`, `breakMinutes`, `breakAfterMinutes`, `planningHorizonDays`. | 422 |
| `GET /dashboard/summary` | Now also `planner` (status, next session/appointment, today's blocks, due today, planned/actual/free minutes). | |
