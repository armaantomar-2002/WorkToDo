# WorkToDo recommendation service – test documentation (Stages 2–3 + final explanation update)

Run from `worktodo_service/`:

```
python -m unittest discover -s tests -p "test_stage*.py" -v     # 109 tests, ~12 s, standard library only
WT_MODULE_DIR=backup/user_v1 python -m unittest tests.test_stage2   # run the suite against a backup copy
```

The suite uses the saved Linear Regression pipeline in `artifacts/` (read-only) and a `StubModel` where exact scores are needed.

## Files
| Path | Purpose |
|---|---|
| `worktodo_features.py` | Current module (source of truth) |
| `backup/user_v1/worktodo_features.py` | Your uploaded file, unchanged (pre-Stage 2) |
| `backup/stage2_final/` | Module and tests as approved at end of Stage 2 |
| `backup/stage3_final/` | Module and Stage 3 tests as approved at end of Stage 3 |
| `backup/CHECKSUMS_before_stage2.sha256` | SHA-256 of model, preprocessor, config (verified by a test) |
| `tests/test_stage2.py` | Eligibility, feasibility/time, categories, input validation |
| `tests/test_stage3.py` | Timing, energy, categoricals, explanations, unusual scenarios, tie-break regression |
| `tests/fixtures/tie_category_sessions.json` | Real dataset sessions S00701, S02652 |

## Input contract (rank_tasks)
Required task fields: `task_id`, `importance`, `goal_contribution`, `consequence_of_delay`, `complexity`,
`estimated_duration_minutes` (> 0), `is_splittable` (true/false), `preferred_time`, `status`.
`minimum_session_minutes` is required (> 0 and <= duration) for splittable tasks only; nonsplittable tasks use their full duration.
Optional/nullable: `task_name`, `start_date` (null = no restriction), `due_date` (null = no deadline), `dependency_status` (null = no dependency).
Session: `session_timestamp`, `available_time_minutes` (>= 0, zero allowed), `longest_free_slot_minutes` (>= 0), `current_time_period`
(Morning/Afternoon/Evening/Night), `energy_level`, `focus_level` (Low/Medium/High).
Dates must not carry a timezone offset. Invalid input raises `InputValidationError` (a `ValueError`; `.errors` lists every problem) -> HTTP 422.
Empty task list -> empty result with a fixed schema.

## Rules verified
* **Eligibility (hard rules, outside the ML model):** only `Pending`/`In Progress`; `Blocked` excluded; `start_date` later than the session time excluded
  (date-only start = from midnight; a start with a time is compared with the session time). Status is checked before dependency.
* **Startable now:** nonsplittable -> full duration <= min(longest slot, available time); splittable -> minimum session <= that slot.
* **Categories:** best startable task = Do now; next two startable = Do next; everything else (incl. high scorers that cannot start) = Schedule later.
* **Ordering:** score rounded to 6 d.p. (desc), then urgency (desc), then task_id (asc). `ml_score` itself is never rounded.
* **Explanations:** *Drivers* = up to three largest weighted contributions among factors that are **not weak**; *Held back by* = every weak factor
  (score <= 40; energy/focus <= 69). Explanation thresholds do not affect scores.
  A startable task in *Schedule later* ends with: "Schedule later: can start now, but N higher-ranked startable tasks already fill the Do now and Do next slots."
  (N counts only startable tasks ranked above it; non-startable tasks keep their own "does not fit the free slot" reason.)

## Tie-breaking and category changes – why this is not a regression
The original ordering sorted by the raw float score, so exactly tied tasks were ordered by floating-point noise (~1e-14) from the linear model.
The new rule orders exact ties by urgency then task_id.

Comparison of the previous and current module on **all 5,000 dataset sessions (63,479 candidates)**:

| Measure | Sessions that differ |
|---|---:|
| Scores, feasibility, startable_now, excluded tasks | **0** |
| Order of tasks (all tied scores) | 109 |
| A task's own category | **2** (S00701, S02652) |

In both category-change sessions two **exactly tied, startable** tasks sit on a category boundary, so whichever is placed first takes the better
category (S00701: positions 3/4, Do next vs Schedule later; S02652: positions 1/2, Do now vs Do next). The more urgent task is now placed first
(urgency 100 vs 50; 70 vs 15). The category counts per session are unchanged. `TestTieBreakIsNotARegression` asserts all of this on the real
fixtures, plus input-order independence and a synthetic boundary tie.

## Stage 3 behaviour changes (all explanation/validation/eligibility only)
1. Splittable task with `minimum_session_minutes` > duration is rejected (no clamping).
2. Invalid categorical values give one clear error listing the field, the offending values, the allowed values and the task ids.
3. "1 day(s)" -> "1 day" / "5 days".
4. Weak factors are no longer called drivers (e.g. "Low importance" was shown as a driver); energy/focus mismatches (score <= 69) are now reported.
5. Eligibility: a `start_date` with a time-of-day is compared with the session time (previously with midnight, which wrongly excluded
   a task that started earlier the same day). Date-only starts (the dataset) behave exactly as before.

Unchanged: model, preprocessor, config, seven factors, weights, mapping tables, energy matrix, target formula, user's consequence wording.

## Known limitations / for later
* Energy/focus match matrix and the Do now/Next rule are inherited/illustrative (see training report).
* FastAPI layer (Stage 4) not yet tested.
