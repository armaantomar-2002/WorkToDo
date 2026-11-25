# WorkToDo recommendation service – test documentation (Stages 2–4)

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

---
# Stage 4 – FastAPI service (standalone)

## Implementation
`app/` wraps the unchanged engine (`worktodo_features.rank_tasks`); no scoring/ranking/eligibility/category/explanation logic is duplicated.
| Module | Role |
|---|---|
| `app/main.py` | `create_app()` factory, lifespan startup checks, routes, exception handlers |
| `app/artifacts.py` | Loads + verifies model, preprocessor, config (read-only; never fits; no fallback model) |
| `app/service.py` | Calls the engine, makes output JSON-safe, builds `/model-info` |
| `app/schemas.py` | Structural request/response schemas (domain validation stays in the engine) |
| `app/errors.py` | `ArtifactError`, framework-independent error-body builders |
| `app/config.py` | Artifact paths; env `WORKTODO_ARTIFACT_DIR`, `WORKTODO_STRICT_STARTUP=1` |

Startup verification: files exist and load; model is the `prep -> LinearRegression` pipeline matching the configured model; feature order = `FEATURES`;
config features/weights = engine; the preprocessor artifact is numerically identical to the pipeline's preprocessing; a 5-row smoke prediction reproduces the
agreed weighted policy (atol 1e-4). Library-version differences vs training are reported as `warnings` in `/health`, not failures. By default a failed check leaves the
service running but not ready (`/health` and the other endpoints return 503); `WORKTODO_STRICT_STARTUP=1` makes startup fail instead.

## Endpoints
| Endpoint | Success | Errors |
|---|---|---|
| `GET /health` | 200 `{status, api_running, model_loaded, preprocessor_loaded, config_loaded, ready, warnings, error}` | 503 when not ready |
| `GET /model-info` | 200 `{model_name, model_type, framework, factors[], weights, score_range, trained_at, artifact_fingerprint, api_version, notes}` (no paths) | 503 |
| `POST /recommend` | 200 `{ranked[], excluded[], summary}` | 400 malformed JSON, 422 validation, 503 not ready, 500 safe generic (`error_id`) |

`ranked[]` keeps the original example's keys (`rank, task_id, task_name, ml_score, category, reason` + the 7 factor scores) and adds `startable_now`.
`excluded[]` = `{task_id, exclusion_reason}`. `summary` = counts. Optional request field `top_k` (>=1, default all). Errors: `{error, message, errors:[{field, message}], error_id?}`;
422 messages are the engine's own `InputValidationError` text, unchanged. Request nulls/omissions are passed through unchanged (`exclude_unset`), so engine rules apply exactly.

Example: `tests/fixtures/sample_request.json`.

## Engine vs service/API consistency
Compared: task ids (type preserved), rank, **unrounded** `ml_score`, category, `startable_now`, all seven factor scores, reason text, excluded tasks + reasons, summary counts.
Permitted serialization differences only: numpy scalars -> Python numbers, NaN -> `null` (e.g. null `task_name`), only the listed fields returned, plus the added `summary` block.
Python's JSON float round-trip is exact, so scores compare with `==`.

## Test status (be precise)
| Suite | File | Type | Status |
|---|---|---|---|
| Stage 2 + 3 | `tests/test_stage2.py`, `test_stage3.py` | unit | **Executed - 109 pass** |
| Artifact loader, service layer, error bodies, integrity, engine-vs-service consistency (9 scenarios + top_k + fixtures) | `tests/test_stage4_service.py` | unit (no FastAPI) | **Executed - 31 pass** |
| Health, model-info, recommend, validation, not-ready/missing/corrupt artifacts, strict startup, safe 500, engine-vs-API consistency | `tests/test_stage4_api.py` | API (TestClient, in-process) | **Written, NOT executed** - fastapi/httpx not installed (32 API+HTTP tests skip) |
| Same endpoints against a real uvicorn process over HTTP, incl. startup failures | `tests/test_stage4_http.py` | HTTP integration | **Written, NOT executed** - fastapi/uvicorn not installed |
| One-off: service vs engine on 1,000 real dataset sessions (14,270 rows) | (ad hoc script, not in repo) | consistency | Executed - identical |

`app/main.py` and `app/schemas.py` have only been compiled (and statically checked by one unit test); they have **never been imported or run with FastAPI**.

## Install and run (VS Code terminal, Python >= 3.11)
```
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m unittest discover -s tests -p "test_stage*.py" -v   # API + HTTP tests run once dependencies exist
uvicorn app.main:app --port 8000                              # then open http://127.0.0.1:8000/docs
```
Pinned ML libraries (`requirements.txt`) match `artifacts/worktodo_training_config.json`; if your artifacts were trained with other versions, adjust the pins (`/health` reports differences).
