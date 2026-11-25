# Phase 1 audit: existing project (read-only; no project file was modified)

## 0. Verification limits
- Audited the copies in this workspace (last delivered ZIPs). I cannot see `C:\Users\armaa\Desktop\Armaan\WorkToDo\WorkToDo`; if anything changed locally, tell me.
- This sandbox has Node 22 and Python 3.12 but **no network, no PostgreSQL, no Prisma, no Docker, no Express/React/Vite**. Nothing from Phases 2-11 that needs an install, a migration, a browser or a running stack can be executed here. Your Windows machine is the verification environment; every phase will ship with exact commands and I will report only what I executed.
- Previously reported by you (not re-run by me): 206 backend tests, 13 live Python tests, manual Node-to-Python integration.

## 1. Existing functionality
**Node (`backend`, Express 5.3, CommonJS, only dependency: express)**: `GET /`, `GET /health` (liveness, `mlService: not_checked`), `GET /ready` (probes Python), `POST /api/v1/recommendations` (stateless: body carries session + tasks).
Layers: `routes/` (thin handlers), `services/recommendationService`, `clients/mlClient` (fetch, 10 s timeout, no retries, 2 MiB streamed response cap, no redirects), `validators/` (request: whitelist, strict types, local date rules, 500-task cap; response contract), `mappers/` (camelCase <-> snake_case, safe 422 translation), `errors/AppError` + fail-closed `errorHandler`, `config/env.js` (PORT, HOST, NODE_ENV, ML_SERVICE_URL, ML_SERVICE_TIMEOUT_MS), `lifecycle.js` (listen errors, graceful shutdown).
Tests: 14 `node:test` files (`node --test`), fake-Python-server helper in `test-support/`, opt-in live suite `test-live/`. `npm test` is hermetic (no DB, no Python).
**Python (`worktodo_service`, FastAPI)**: `GET /health` (200/503), `GET /model-info`, `POST /recommend`; Linear Regression pipeline + fitted preprocessor + seven-factor engine; Stage 2-4 tests. Note: there are three endpoints, not two (`/model-info` exists).

## 2. Missing (everything the new brief adds)
No frontend, no database/Prisma, no authentication/authorization, no users, tasks, sessions, history, dashboard, insights, settings, CORS, cookies, rate limiting, controllers/repositories.

## 3. Findings that change the proposed design (details in CONTRACT_MAPPING.md)
1. **Endpoint conflict.** `POST /api/v1/recommendations` already exists and is stateless (client supplies tasks; ~70 of the existing tests bind to that path and shape). The new flow must load tasks server-side for the authenticated user (never trust client-supplied tasks), run Python, and persist. **Proposal (D1):** leave the existing route and tests untouched; add `POST /api/v1/recommendations/runs` (authenticated, `{sessionId | session, topK?}`), plus `GET /history` and `GET /history/:id`. In production the stateless route is disabled by a config flag (default on in development/test) so unauthenticated callers cannot use it.
2. **Enums must match Python exactly** (case and spaces: "No linked goal", "In Progress", "Do now"). Proposal: Prisma enums with `@map("...")` for task fields (identity mapping to Python); `category` and `exclusionReason` as TEXT (Python owns those sets; an enum would make persistence fail after a successful ML call if Python adds a value).
3. **Dates**: task dates as `DATE`; session wall-clock as `TIMESTAMP(0)` (no tz) behind one helper; audit instants `TIMESTAMPTZ`; add `UserPreferences.timeZone` for day bucketing (section 5 of the mapping doc). Frontend sends `datetime-local` values (`YYYY-MM-DDTHH:mm`), which the existing validator accepts; it must never use `toISOString()` for these.
4. **Historical integrity**: tasks soft-deleted (`deletedAt`, "archive"); history rows keep `taskId` (nullable FK, SET NULL) + `taskNameSnapshot` + small `taskSnapshot` JSON; each run stores its own session-context snapshot (so editing/deleting a saved session never rewrites history).
5. **Schema additions beyond the nine models** (all justified by the brief's own requirements): `Task.description/deletedAt`; `RecommendationRun` context snapshot + `topK` + `startableNow`; item/exclusion snapshots; `AuthSession.familyId/replacedById/lastUsedAt/userAgent` (refresh-rotation reuse detection and the Settings session list); `UserPreferences.timeZone`.
6. **500-task cap vs a growing task list.** Node sends active tasks (Pending/In Progress, not archived) plus the most recent inactive ones up to 500 total, so the "Excluded Tasks" panel still shows completed tasks as in the mockup; if a user has more than 500 *active* tasks the run returns a clear 422 asking them to complete or archive some (D6, default shown).
7. **Dashboard "Today's Recommendation"** reads the latest persisted run (no Python call on page load); it shows the run time and an empty state with a "Get Recommendations" action when none exists.
8. **Insights honesty**: focus sessions are plans (available minutes), not timed work, so "Avg. Focus Time" = average planned available minutes; "Task Completion Trend" = cumulative completion rate by day (`completedAt`), "Productivity Over Time" = tasks completed per day. No fabricated figures; empty states when no data.
9. **Existing tests stay hermetic.** DB-backed routes mount only when a database is configured; `npm test` keeps running without PostgreSQL. New DB tests run via a separate `npm run test:db` against a dedicated `worktodo_test` database using real migrations (no Prisma mocking).
10. **Email**: no provider is configured, so forgot-password uses a provider abstraction with a development provider that writes the reset link to the server console only; the endpoint always returns a generic response. Email verification flow is out of scope (`isEmailVerified` stays false). I will not claim email delivery.
11. **Auth design**: Argon2id hashing; 15-minute access JWT kept in memory on the client; rotating refresh token in an HttpOnly, `SameSite=Strict`, path-scoped cookie, hashed in DB with reuse detection; CSRF mitigated by SameSite + Origin check + a required custom header on cookie-based endpoints; manual CORS allowlist (credentials) and a Vite dev proxy so development is same-origin; rate limiting on auth endpoints; "Remember me" = persistent vs session cookie.

## 4. Proposed dependencies (new; the "no new dependencies" rule applied to Stage 6 only, but please confirm)
Backend: `@prisma/client`, `prisma` (dev), `argon2`, `jose` (JWT), `cookie`, `express-rate-limit`. Validation stays hand-written like the existing validators; no `cors`/`cookie-parser`/`zod` on the backend.
Frontend: react, react-dom, react-router-dom, @tanstack/react-query, react-hook-form, zod, @hookform/resolvers, lucide-react, recharts, tailwindcss (+ Vite plugin), typescript, vite, @vitejs/plugin-react, @fontsource/lora + @fontsource/inter (no runtime CDN), vitest, @testing-library/react, jsdom, @playwright/test (E2E).
Prisma and Playwright download engines/browsers on first use (needs internet on your machine).

## 5. Proposed structures
Backend additions: `src/{controllers,repositories,db,auth,email}/` + new `routes/`, `services/`, `validators/`; existing files change only additively (`app.js` mounting, `config/env.js` new settings, `server.js` Prisma lifecycle), each backed up first. Frontend: the structure in your brief (`frontend/src/{components,features,pages,routes,services,hooks,lib,types,styles}`), TypeScript strict, API layer separate from components.
Design reference (nine screens, observed): left sidebar with 6 items + profile; ivory page `#fcf6ed`/`#fbf5eb`, white cards, warm borders `#e6e0d6`, charcoal buttons/active nav, serif headings, pill tabs, tinted badges (Critical terracotta, Low dusty blue, High/Pending amber, Completed olive), olive ring and line chart, accordion for Excluded Tasks. The three hand-drawn illustrations will be recreated as SVG; they will be close in spirit, not pixel copies (you can swap in the original artwork later).

## 6. Risks
Unverifiable here (see section 0); Windows PostgreSQL/Prisma setup; timezone handling; token-rotation edge cases; scale of the change (about 9 pages, 20+ endpoints, 9+ models) versus verifying each phase on your side; in-memory rate limiter is single-instance; Playwright download size; illustration fidelity.

## 7. Plan (unchanged phase order; each phase ends with exact commands for you to run and the results I can/cannot claim)
2 frontend foundation + design system; 3 Prisma/PostgreSQL + migrations + seeds; 4 authentication; 5 tasks; 6 sessions; 7 recommendations (runs, persistence, history) ; 8 dashboard; 9 insights; 10 settings + landing/auth pages polish; 11 integration, E2E and docs.
Order note: Phase 2 (frontend) needs no database; Phase 3 onward needs PostgreSQL on your machine.

## 8. Test baseline to preserve
Existing hermetic suite (`npm test`) and `npm run test:live`; I will re-run what is runnable here after each backend change (sandbox lacks Express, so Express-dependent files will only be verifiable on your machine).
