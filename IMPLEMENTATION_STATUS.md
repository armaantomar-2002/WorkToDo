# WorkToDo full-stack: implementation status
Legend: DONE = written; VERIFIED-SANDBOX = executed in the Linux sandbox (Node 22, no network/PostgreSQL/Express/React); PENDING-LOCAL = must be run on the Windows machine.
Corrected baseline: the earlier '72 Express tests' claim was wrong. Static count: 32 `test()` calls in the 3 Express files; 200 in the others (runner: 214 pass). See docs/VERIFICATION.md.

| Phase | Scope | Status |
|---|---|---|
| 1 | Audit (`phase1-audit/`) | DONE |
| 2 | Frontend foundation + design system | DONE (written; build/typecheck/tests PENDING-LOCAL) |
| 3 | Prisma schema, migration, seed, config | DONE (migration SQL VERIFIED-SANDBOX on PostgreSQL 16; Prisma client/migrate PENDING-LOCAL) |
| 4 | Authentication | DONE backend (service logic VERIFIED-SANDBOX with in-memory stand-ins; real argon2/jose/Express/DB PENDING-LOCAL) |
| 5 | Tasks | DONE backend (same verification level) |
| 6 | Focus sessions | DONE backend (same verification level) |
| 7 | Recommendation runs + history | DONE backend (same verification level) |
| 8 | Dashboard | DONE backend + page (page PENDING-LOCAL verification) |
| 9 | Insights | DONE backend + page (PENDING-LOCAL verification) |
| 10 | Settings + landing/auth pages | DONE (written; PENDING-LOCAL verification) |
| 11 | Integration tests, E2E, README, packaging | DONE (written; DB specs, Vitest, Playwright NOT executed: PENDING-LOCAL) |

## Resume notes
Backups of every modified pre-existing backend file: `backend/backup/fullstack-pre/` (checksums included). New backend code lives in `backend/src/{modules,auth,http,db,utils,constants,email,api}` (NOT in services/validators/mappers/clients/routes: existing static tests scan those directories).


## Progress log
- Backend complete: `src/{config,constants,utils,http,auth,email,db,api,modules/*}`, `prisma/seed.js`, `.env.example`, `.env.test`.
- Sandbox-executed: existing 134 tests + 51 new hermetic tests (`test/fullstack-pure.test.js`, `test/fullstack-services.test.js`) = 185 passing; 3 files (72 tests) need Express (not installable here, unchanged baseline).
- Sandbox-executed: `migration.sql` applied to a real PostgreSQL 16 cluster; seed-equivalent rows inserted; CHECK constraints rejected invalid rows.
- PENDING-LOCAL: `npm install`, `npx prisma generate`, `npx prisma migrate deploy`, `npm test` (full 206+51), `npm run test:db` (`test-db/*.db.spec.js`), seed, real argon2/jose.
- Frontend written (all pages, design system, hooks, tests, E2E). Sandbox-only checks: shimmed tsc (shim noise only) and format.ts tests (5/5).
- Docs: README.md, docs/{API,EMAIL,VERIFICATION}.md. Remaining steps are the Windows commands in docs/VERIFICATION.md.

## Correction pass (final)
- DONE (written + hermetic tests executed with stand-ins; real DB SQL verified on PG16; Prisma/Express/React runs PENDING-LOCAL): focus timer (pause intervals, server-computed elapsed, one active per user), task dependencies (cycle/ownership, derived status), recommendation feedback (CRUD, ownership FKs), dashboard/insights from actual timer data, frontend panels, lockfile handling, docs, `docs/FINAL_ACCEPTANCE_CHECKLIST.md`.
- Sandbox run: backend 214 pass / 3 files need Express; Python 140 pass, 32 skipped (FastAPI missing); both migrations applied on PostgreSQL 16.
- Continuation point if interrupted: nothing outstanding in code; remaining work is the Windows run list in docs/VERIFICATION.md.

## Enhancement pass (daily planner) — complete
- DONE & executed here: scheduler engine + validator (38), planner services (33: appointments, drafts, approval, stale drafts, concurrency, rollback, moves, breaks, postponement, calendar, time zone, ownership), complexity-optional (4), migrations 1-4 on real PG16, planner constraints in real SQL, pure frontend logic (`planner` 8, `plannerForms` 5 via a Node shim), Python ML (140 pass / 32 skipped).
- DONE, written but NOT run here (needs your toolchain): planner UI (Planner page with Day/Week/Month, drag-and-drop, appointment/break/postpone dialogs, Availability settings, dashboard widget), Vitest component tests, Playwright specs (`planner.spec.ts`), `test-db/planner.db.spec.js`, `tsc`, build.
- DEFERRED by decision 47: recurrence, notifications, break resizing.
