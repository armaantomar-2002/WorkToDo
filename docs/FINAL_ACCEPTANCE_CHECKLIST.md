# Final acceptance checklist

Status values: **CV** Complete and verified · **INE** Implemented but not executed · **PI** Partially implemented · **NI** Not implemented · **ENV** Environment-dependent.
"Verified" means executed in the build sandbox; hermetic backend tests use in-memory stand-ins for Prisma/argon2/jose, so they do not prove the real libraries. "Windows" = must be confirmed on your machine.

| # | Requirement | Where | Status | Evidence | Windows check |
|---|---|---|---|---|---|
| 1 | Persistent focus timer: start/pause/resume/finish/cancel, task link, planned vs actual, pause intervals, history | `backend/src/modules/timer/*`, migration 2, `frontend/src/components/timer/*`, SessionsPage | INE | 18 lifecycle tests pass (stand-in DB); migration + constraints executed on real PG16 | `npm test`, `test:db`, e2e `timer.spec.ts` |
| 2 | Elapsed from server/DB timestamps; reload-safe | `timer.calc.js`, `lib/timer.ts` | CV (logic) / INE (browser) | calc tests + 6 frontend shim-run tests pass | manual refresh test |
| 3 | One active timer per user; duplicate start/finish, invalid transitions, cross-user blocked | partial unique index, guarded `updateMany` | CV at SQL level; INE via API | unique index rejection executed on PG16; tests pass with stand-in | `test:db` |
| 4 | Timer in dashboard + insights | `dashboard.service.js`, `insights.*`, pages | INE | calc tests pass | visual check |
| 5 | Recommendation feedback model/CRUD/ownership/UI/history | `feedback.service.js`, `RecommendationFeedback`, `FeedbackBar.tsx` | INE | 11 tests (stand-in); composite FK + CHECK executed on PG16 | `test:db`, manual |
| 6 | Real task dependencies: link/unlink, blocked detection, no self/cycle, ownership, deleted prerequisites | `tasks/dependencies.js`, `TaskDependency`, `DependencyManager.tsx` | INE | tests pass (stand-in); self-CHECK/FK executed on PG16 | `test:db`, e2e `dependencies.spec.ts` |
| 7 | Exact Python contract values; Python rules unchanged | `runs.service.js` derivation; `worktodo_service/` | CV (unchanged) / INE (live call) | Python checksums OK; Python 140 pass | run one recommendation |
| 8 | Auth: Argon2id, JWT expiry, refresh rotation/families/reuse detection, logout invalidation | `modules/auth`, `auth/tokens.js`, `requireAuth.js` | INE | 12 service tests (stand-in argon2/jose); code audit in Decision 31 | `npm test` with real libs, e2e `auth.spec.ts` |
| 9 | Cookies HttpOnly/SameSite/Secure, CSRF, CORS, no tokens in localStorage/logs | `http/cookies.js`, `http/security.js`, `frontend/src/lib/api.ts` | CV (unit) / ENV (Secure needs HTTPS) | cookie/CORS/CSRF tests pass without Express; grep: only theme in localStorage | check cookie flags in DevTools |
| 10 | Cross-user authorization matrix | task/session/run/timer/dependency/feedback services scope by `userId` | INE | tests assert 404 on other users' tasks, sessions, runs; timer/dependency/feedback covered in new tests | `test:db` |
| 11 | Password reset hashed, expiring, single-use; dev-only link, no fake email | `auth.service.js`, `email/provider.js`, `docs/EMAIL.md` | INE | test passes (stand-in) | request reset, read link from backend console |
| 12 | DB integrity: FKs, indexes, uniques, CHECKs, DATE/wall-clock/TIMESTAMPTZ, soft delete, snapshots, transactions | `schema.prisma`, 2 migrations | CV (SQL) / INE (Prisma) | both migrations applied in order on fresh PG16 | `prisma migrate deploy` on a fresh DB |
| 13 | Timezone design (no UTC conversion of session local time) | unchanged mapper + wall-clock columns | CV | `fullstack-pure` date tests pass | none |
| 14 | Frontend: nine pages + forgot/reset/404, no inert controls, states | `frontend/src/pages` | INE / PI | written; only shimmed typecheck and 11 shim-run tests executed; no browser run | click through every page, both themes |
| 15 | Route guards | `auth/Routes.tsx` + `routes.test.tsx` | INE | test written, not run | `npm test` |
| 16 | ML regression: stateless endpoint unchanged; runs/history; one Python call per run; 500-task rule; no fabricated scores | `recommendation*` files | CV (unit, stand-in client) / INE (Express route tests) | service tests pass; 3 Express files unexecuted | `npm test` |
| 17 | Personalisation not claimed | docs/UI copy | CV | no such claim made | none |
| 18 | Package management: lockfiles | `package.json` engines, `.nvmrc` | **PI** | **No lockfiles shipped** (no network). Stale backend lock removed | `npm install` in each folder, commit the locks |
| 19 | Test-count reconciliation | `docs/VERIFICATION.md` | CV | counts taken from files; Express-file claim corrected | none |
| 20 | Windows PowerShell setup (PG16 DBs, env, Prisma, seed, venv, run, tests, build) | `README.md` | INE | commands written, not run on Windows | follow README |
| 21 | Safe `.env.example` files | `backend/.env.example`, `frontend/.env.example` | CV | placeholders only, empty JWT secret | none |
| 22 | Email/notification honesty | `docs/EMAIL.md`, provider | CV | provider returns `delivered:false`; notifications are preferences | none |
| 23 | Status/decisions/checklist/verification docs | root + `docs/` | CV | present | none |
| 24 | Real email delivery, email verification, notification delivery | – | NI | by design | – |
| 25 | Python API tests (FastAPI/httpx) | `worktodo_service/tests` | ENV | 32 skipped here | run with `requirements-dev.txt` |
| 26 | Frontend build, Vitest, Playwright | `frontend/` | ENV / INE | not run | see VERIFICATION.md |
| 27 | Appointments: create/edit/cancel/reschedule, overlap rejection, history, ownership | `backend/src/modules/planner/appointments.*`, `AppointmentModal.tsx` | CV (backend, stand-in) / INE (UI, real DB) | 33 planner tests + SQL constraints | run `npm run test:db`, e2e |
| 28 | Working hours, days, breaks, horizon, unavailable periods | users service/validator, `AvailabilityTab.tsx` | CV (backend, validators) / INE (UI) | tests incl. a day-off respected | e2e |
| 29 | Persistent scheduling engine integration, drafts, approve/reject, versions, stale-draft and concurrency protection | `schedule.service.js`, migration 4 | CV (stand-in, serialised transactions) / INE (real DB races) | tests incl. one-winner approval and rollback | `planner.db.spec.js` |
| 30 | Breaks (auto-suggest, manual, accept, remove, re-plan displaced) | `schedule.service.js`, `PlannerDialogs.tsx` | CV (backend) / INE (UI) | tests | e2e |
| 31 | Task postponement + history, confirmation past deadline | `postpone.service.js`, `PostponeDialog` | CV / INE (UI) | tests | e2e |
| 32 | Planned vs actual, remaining time after overrun | `context.js`, `calendar.service.js` | CV | overrun test | – |
| 33 | Day/Week/Month calendar, month hover/tap summary | `CalendarViews.tsx`, `lib/planner.ts` | CV (pure logic in Node) / INE (rendering) | 8 pure tests | e2e, manual check on phone/tablet/desktop |
| 34 | Drag-and-drop with backend conflict validation and a touch/keyboard "Move to…" fallback | `CalendarViews.tsx`, `BlockDialog` | CV (backend validation) / INE (browser DnD) | invalid moves rejected, nothing saved | manual + e2e |
| 35 | Dynamic rescheduling on overrun / appointment change / cancellation (approved plan preserved) | `schedule.service.js` | CV | tests | – |
| 36 | Dashboard planner widget | `summary.js`, `DashboardPage.tsx` | CV (backend) / INE (UI) | – | manual |
| 37 | Time zone consistency (default Asia/Kolkata, DST not modelled) | `wall.js`, `clock.ts` | CV | midnight-boundary tests | none; documented limit |
| 38 | Recurrence, notifications, break resizing | – | NI | deferred, decision 47 | – |

Nothing in this table is marked complete merely because a page or model exists.
