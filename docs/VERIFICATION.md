# Verification report (honest record)

"Executed" = actually run in the Linux build sandbox (no network: no npm/pip installs, so no Express, Prisma, argon2, jose, React toolchain, FastAPI). Everything else is **written but not run** and must be run on Windows. Nothing below claims otherwise.

## Test inventory (counted from the files)
| Suite | Cases (static count) | Status |
|---|---|---|
| Backend hermetic tests (incl. `scheduler` 38, `planner` 33, `complexity-optional` 4), files that don't need Express | 275 `test()` calls in those files; runner reports **289 passing** (the runner also counts each `describe` suite as a test, so its total is higher than the static count) | **Executed, pass.** Use in-memory Prisma/argon2/jose **stand-ins** (`test-support/`): they prove service logic, NOT the real libraries |
| Backend tests needing Express: `app`, `ml-startup`, `recommendations.api` | 32 | **Not executed** (`Cannot find module 'express'`). Node counts each failing file as 1, so the runner shows `tests 292 / pass 289 / fail 3`. The earlier "72 Express tests" figure was wrong |
| Of which: timer 18, dependencies+feedback 11, planner 33, scheduler 38 | 100 | Executed (stand-in / pure), included in the 289 |
| Backend real-DB specs `test-db/` (schema 7, api 18, timer-deps-feedback 12, planner 6) | 43 | **Not executed** (need Prisma + Express + PostgreSQL). Environment-dependent |
| Real PostgreSQL 16 SQL checks on both migrations | ad-hoc SQL | **Executed**: both migrations apply in order on a fresh PG16; CHECKs, composite FKs and the two partial unique indexes rejected bad rows |
| Python ML service `worktodo_service/tests` | 140 passed, 32 skipped, 633 subtests | **Executed** (Python 3.13). The 32 skips are the FastAPI/httpx API tests (package not installed here) → run on Windows with `requirements-dev.txt` |
| Frontend Vitest (api 8, format 5, timer 6, features 10, forms 9, ui 8, routes 4, duration 3, clock 4, planner 8, plannerForms 5) | 70 | Pure-logic files (`format`, `timer`, `clock`, `duration`, `planner`, `plannerForms`) were run in Node through a tiny runner shim; the React/Testing-Library files (`api`, `features`, `forms`, `ui`, `routes`) were **not executed** |
| Frontend Playwright (auth 5, dependencies 1, flow 5, tasks 2, timer 3, planner 2) | 18 | **Not executed** (need the full stack running) |
| Frontend `tsc` | – | Run against `any`-shims for third-party packages: shows only shim noise. It does **not** prove React/Router/Query/zod/Recharts typing |
| Python artifacts vs `backup/CHECKSUMS_before_stage2.sha256` | – | **Executed**: all OK, model/preprocessor/config unchanged |

## Lockfiles
No network → `npm install` could not run, so no valid lockfile can be produced. The previous `backend/package-lock.json` listed only Express and was stale; it was **removed** rather than shipped wrong. `frontend/package-lock.json` never existed. Run `npm install` in each folder once (creates both), then commit them. `package.json` has `engines` (Node >=20.19, npm >=10); `.nvmrc` = 22.

## Run on Windows, in this order
1. `cd backend; npm install; npx prisma generate; npx prisma migrate deploy` (use **deploy**, not `migrate dev`: the migrations contain partial unique indexes Prisma cannot express, so `migrate dev` may report drift and offer a reset).
2. `npm test` (expect all pass, 0 failing files), `npm run test:db`.
3. `cd worktodo_service; pip install -r requirements-dev.txt; python -m pytest -q tests` (expect 0 skipped for API tests).
4. `cd frontend; npm install; npm run typecheck; npm test; npm run build` (expect to fix small real-type issues: the sandbox could not check them).
5. Start all three services, then `npm run e2e:install; npm run e2e` (selectors may need small tweaks).
6. Manual pass over the nine pages in light and dark themes.

## Enhancement pass additions
- Backend run in sandbox: `tests 259 / pass 256 / fail 3` (the same 3 Express-dependent files). Scheduler: 38 pass.
- Migration `20261126000000_...` applied on real PostgreSQL 16 after migrations 1-2 with an existing task (complexity `Complex`) and user (zone `UTC`): both preserved, defaults changed.
- Clock/local-date logic checked in Node with real `Intl`: 18:29:59Z -> 24 Nov, 18:30:00Z -> 25 Nov in Asia/Kolkata.
- NOT run: Vitest (duration, clock, forms, routes, features incl. the fixed timer test), `tsc`, build, Playwright. Run on Windows: `cd frontend; npm run typecheck; npm test; npm run build`.
- Apply the database change (never reset): `cd backend; npx prisma migrate deploy; npx prisma generate`.

## Planner pass results (this session)
- **Executed, pass:** `scheduler` 38/38 (incl. 1000 random scenarios), `planner` 33/33, `complexity-optional` 4/4, `timer` 18/18, `dependencies-feedback` 11/11. Full backend run: `tests 292 / pass 289 / fail 3`.
- **The 3 failures** (`app`, `ml-startup`, `recommendations.api`) are `Cannot find module 'express'`: Express is not installed in the sandbox, so they cannot be investigated here. They did not fail because of the new code. Run `cd backend; npm install; npm test` on Windows; if any of them fails there, treat it as real.
- **Python:** `python -m pytest tests` → 140 passed, 32 skipped (FastAPI/httpx missing here). Do not run pytest from the service root without `tests`: it also collects `backup/` and fails on a stale path.
- **ML artifacts:** checksum file verifies, all OK.
- **Real PostgreSQL 16:** migrations 1-4 apply in order over existing rows; `test-db/planner-constraints.sql` rejects every bad row it should and cascades deletes.
- **Frontend:** a real-type problem was found and fixed by the type check (an unused helper in `TaskFormModal.tsx` that `noUnusedLocals` would have failed the build on). The type check still runs against shims for React/Router/Query, so run the real one: `cd frontend; npm run typecheck; npm test; npm run build`.
- **The earlier timer test fix** (assert `elapsed >= 300 && < 305` and `elapsed + remaining === 1500`) has still not been run under real Vitest.
- **Not executed anywhere here:** Vitest component tests, Playwright, the Express route tests, `test-db/*.db.spec.js` (including `planner.db.spec.js`), the production build. Expect to fix small issues the first time they run.
