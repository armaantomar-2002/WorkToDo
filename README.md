# WorkToDo

Task prioritisation app: React (Vite + TypeScript + Tailwind) → Node/Express API → PostgreSQL 16 (Prisma) and the existing Python FastAPI ML service.

```
frontend/         React SPA (port 5173, proxies /api to the backend)
backend/          Node/Express API (port 5000), Prisma schema + migration + seed, tests
worktodo_service/ Python ML service (port 8000), unchanged model artifacts
docs/             API.md, EMAIL.md, VERIFICATION.md, FINAL_ACCEPTANCE_CHECKLIST.md (per-requirement status)
IMPLEMENTATION_STATUS.md / IMPLEMENTATION_DECISIONS.md
```

The browser talks only to Node. Node talks to PostgreSQL and (for recommendation runs) to the Python service. Python never touches the database.

## Windows setup (PowerShell)

Prerequisites: Node.js 20.19+ or 22 LTS (npm 10+), Python 3.11–3.13 (the pinned pandas 3.x needs 3.11+; the Python tests were run here on 3.13), PostgreSQL 16 (add `C:\Program Files\PostgreSQL\16\bin` to PATH). Start PowerShell in the unzipped folder.

### 1. Database (once)
```powershell
psql -U postgres -c "CREATE USER worktodo WITH PASSWORD 'choose-a-password';"
psql -U postgres -c "CREATE DATABASE worktodo OWNER worktodo;"
psql -U postgres -c "CREATE DATABASE worktodo_test OWNER worktodo;"
```
Prisma's migrate needs to create a shadow database in development: `psql -U postgres -c "ALTER USER worktodo CREATEDB;"`.

### 2. Python ML service (terminal 1)
```powershell
cd worktodo_service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Check: `Invoke-RestMethod http://127.0.0.1:8000/health`.

### 3. Backend (terminal 2)
```powershell
cd backend
Copy-Item .env.example .env
```
Edit `.env`: replace `CHANGE_ME_DEV_PASSWORD` in `DATABASE_URL` with your password, and set `JWT_ACCESS_SECRET` to a random value of 32+ characters:
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
`.env.test` is already included (database `worktodo_test`); replace its `CHANGE_ME_DEV_PASSWORD` too. Then:
```powershell
npm install            # creates package-lock.json (none is shipped, see docs/VERIFICATION.md)
npx prisma generate
npx prisma migrate deploy
npm run db:seed        # optional dev demo data: demo@worktodo.local / DemoPassword123
npm run dev
```
Check: `Invoke-RestMethod http://localhost:5000/health`.

### 4. Frontend (terminal 3)
```powershell
cd frontend
npm install            # creates package-lock.json
npm run dev
```
Open http://localhost:5173 .

### Tests and checks
```powershell
cd backend;  npm test                 # unit + API tests (no database needed)
cd backend;  npm run test:db          # real PostgreSQL; refuses to run unless the DB name ends in _test
cd frontend; npm run typecheck; npm test; npm run build
cd frontend; npm run e2e:install; npm run e2e   # needs PostgreSQL, the Python service, the backend and the frontend running
```
`e2e` creates unique users per test; it needs the Python service running for the recommendation flow.

### Production notes
`NODE_ENV=production` requires `JWT_ACCESS_SECRET` (32+ chars), `FRONTEND_ORIGIN`, and secure cookies (HTTPS). The stateless `POST /api/v1/recommendations` is then disabled (set `ENABLE_STATELESS_RECOMMENDATIONS=true` to keep it). The seed refuses to run in production. Email delivery is not implemented (see `docs/EMAIL.md`).

## Daily planner
Open **Planner** in the sidebar. Add appointments (fixed; buffers supported), set working hours/days, breaks and unavailable periods in **Settings → Availability**, then **Generate schedule**. A draft is shown dashed and is *not active*; review conflicts and unscheduled tasks (with reasons), drag sessions (or use "Move to…"), add breaks, then **Approve** or **Reject**. Your approved schedule is never changed without your approval. Postpone a task from **My Tasks**. Day, Week and Month views; hover (desktop) or tap (mobile) a month date for its summary. Default time zone is Asia/Kolkata. Recurrence and notifications are deferred (decision 47).

Apply the database change safely (never reset):
```powershell
cd backend
npx prisma migrate deploy
npx prisma generate
```

## Security summary
Argon2id password hashes; 15-minute JWT held in memory; rotating refresh token (hashed in DB) in an HttpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`; reuse detection; per-request DB session check; CSRF header + Origin allowlist; rate-limited auth endpoints; strict input validation; every query scoped to the authenticated user; generic auth errors (no email enumeration); security headers; no secrets in the frontend.


## Focus timer, dependencies, feedback
- **Focus timer** (Focus Sessions page and Dashboard): start / pause / resume / finish / cancel, stored in PostgreSQL; elapsed time is computed from server timestamps, so it survives refresh, other devices and restarts. One active timer per user (enforced by a partial unique index).
- **Task dependencies** (task form → Prerequisites): link/unlink with cycle and ownership checks. Blocked/Ready is derived, never typed in.
- **Recommendation feedback** (Recommendations page and history): helpful / not helpful / already done / not relevant + optional comment, saved per recommended item.

## Windows one-shot helper
Everything above can be copy-pasted from this README. Test commands (PowerShell, services running where noted):
```powershell
cd backend;  npm test; npm run test:db            # test:db needs worktodo_test and .env.test passwords
cd ..\worktodo_service; python -m pytest -q tests  # after pip install -r requirements-dev.txt
cd ..\frontend; npm run typecheck; npm test; npm run build; npm run e2e:install; npm run e2e
```
Production build: `cd frontend; npm run build` (output `dist/`); backend: `NODE_ENV=production` with a real `JWT_ACCESS_SECRET`, `FRONTEND_ORIGIN` and HTTPS.

Notifications are **preferences only**; nothing is sent. Password-reset links are printed to the backend console in development (no email is delivered).
