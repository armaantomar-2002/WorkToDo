> **Status (this pass):** Phases 4–6 (appointments, availability, drafts/approval/versions, breaks, postponement, planned-vs-actual, calendar, drag-and-drop, dynamic re-planning, dashboard) are implemented; see `IMPLEMENTATION_STATUS.md` and `docs/VERIFICATION.md` for what was and was not executed. Recurrence, notifications and break resizing are deferred (decision 47).

# Intelligent daily planner: audit, plan and progress

## Audit (Phase 1)
| Feature | Status found | Change | Risk |
|---|---|---|---|
| Task management | CRUD, soft delete, dependencies, timer, feedback: working | Remove Complexity input; hours/minutes duration | Low |
| Fixed appointments | Missing | New model/API/form (Phase 4) | Medium |
| Flexible scheduling | Missing (ranked list only) | Deterministic engine (**done, Phase 3**) | High |
| Recommendation engine / ML | Working; ranks only | Unchanged | Low |
| Calendar | Missing | Day/week/month (Phase 5) | High |
| Dynamic rescheduling | Missing | Engine supports it (locked blocks, cancelled appointments); API/UI in Phase 4 | High |
| Availability, breaks, versions, postponement | Missing | Tables + API (Phase 4) | Medium |
| Recurrence, notifications | Missing | Deferred (see below) | – |

**Complexity** feeds `energy_suitability` (5% weight) through `energy_score(energy, focus, complexity)`, and Python requires it. Model, weights, preprocessing and artifacts are untouched. Node now defaults it to `Moderate`; stored values are kept. Effect: energy suitability no longer varies by task, only by the user's energy/focus. Product decision, not a model change.

**Date bug root cause:** `UserPreferences.timeZone` defaulted to `UTC`, and the dashboard's "today" is computed in that zone. At 03:19 IST on 25 Nov it is still 24 Nov in UTC. Fixes: new users default to `Asia/Kolkata`; live clock uses the user's zone; a one-click notice offers the device zone to existing UTC users (never changed silently). Date-only values were already handled without zone conversion.

**Timer test failure:** the fixture (300 s elapsed of 1500 s) correctly renders 5:00 / 20:00 at the fetch instant; `19:5x` only holds after a tick. The test now asserts `elapsed + remaining = planned` and `300 <= elapsed < 305`. Product code unchanged.

## Done in this pass
Phase 2 (task form, duration, time zone, clock, timer test) and Phase 3 (engine + validator). See `IMPLEMENTATION_STATUS.md`.

## Remaining (in order)
4. Appointment model (+history), UnavailablePeriod, availability preferences, ScheduleVersion (draft/approved/superseded), ScheduledBlock, Break, TaskPostponement; draft/approve/reject API using `validateSchedule` inside a transaction; stale-draft detection (hash of inputs); postponement; actual-vs-planned feedback into estimates.
5. Calendar (day/week/month), timeline, drag-and-drop through the validator, dashboard changes.
6. Personalisation: only after real data exists; evaluate with MAE/Precision@K before any model change.
7. Security tests for the new endpoints, concurrency, responsive checks.

## Deferred, with reasons
- **Recurrence:** needs an occurrence-vs-series model; deferring avoids compromising the planner. Appointments will be single occurrences.
- **Notifications:** preference only today; real reminders need a delivery channel (email/push), which needs your approval.
