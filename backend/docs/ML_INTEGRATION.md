# Node.js <-> Python ML integration (Stage 6)

Node is the API gateway; Python (`worktodo_service`) is the only place recommendations are computed. Node validates, renames
fields, calls Python, verifies the response contract and renames fields back. It never scores, ranks or categorizes.

## Endpoints
| Endpoint | Purpose |
|---|---|
| `POST /api/v1/recommendations` | body `{session, tasks[], topK?}` (camelCase) -> `{ranked[], excluded[], summary}` |
| `GET /ready` | readiness: 200 only when the Python service reports ready; otherwise 503 |
| `GET /health`, `GET /` | unchanged; liveness only, never probe Python (`mlService: not_checked`) |

## Request (public) -> Python
Session: `localTime`->`session_timestamp`, `availableTimeMinutes`, `longestFreeSlotMinutes`, `currentTimePeriod`, `energyLevel`, `focusLevel` (snake_case in Python).
Task: `taskId, taskName, startDate, dueDate, importance, goalContribution, consequenceOfDelay, complexity, estimatedDurationMinutes, minimumSessionMinutes, isSplittable, preferredTime, dependencyStatus, status`. `topK`->`top_k`.
Unknown properties are rejected (422). Numbers must be JSON numbers, `isSplittable` a boolean. Allowed values and domain rules are enforced by Python (its 422s are relayed in safe, camelCase form).
Optional (`taskName, startDate, dueDate, minimumSessionMinutes, dependencyStatus`): omitted stays omitted, `null` stays `null`.

## Date/time
`localTime` is the user's local wall-clock time (`YYYY-MM-DD HH:mm[:ss]` or with `T`), passed to Python byte-for-byte. Node never builds a `Date`, never assumes UTC and
never converts timezones. `Z`/offset values (`...Z`, `+05:30`) are rejected, for `localTime` and for `startDate`/`dueDate`. Date-only values are allowed for task dates, not for `localTime`.

## Limits
500 tasks per request (empty list allowed); 1 MB request body; upstream response max **2 MiB**, enforced while streaming (a 500-task response is ~0.3 MB);
10 s default timeout (`ML_SERVICE_TIMEOUT_MS`, 100-120000); no retries; redirects are never followed.

## Errors (same in every NODE_ENV; messages are fixed, never upstream text)
| Situation | Status | `error` |
|---|---|---|
| Node validation / Python 422 | 422 | `validation_error` (`errors:[{field, message, taskIds?}]`) |
| Python 400/404/405/other 4xx | 502 | `ml_contract_error` |
| Python 500 / unclassified failure | 502 | `ml_service_error` |
| Python 503 / connection refused or reset | 503 | `ml_service_unavailable` |
| Timeout | 504 | `ml_timeout` |
| Invalid JSON, wrong structure, contract violation, oversize | 502 | `ml_invalid_response` |
5xx bodies carry an `errorId`; upstream status/`error_id` and causes are logged server-side only.

## Configuration
`ML_SERVICE_URL` (default `http://127.0.0.1:8000` for development/test/unset; **required** in staging/production, checked at startup), `ML_SERVICE_TIMEOUT_MS` (default 10000).

## Run both services locally (Windows PowerShell)
```
# terminal 1
cd worktodo_service; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --host 127.0.0.1 --port 8000
# terminal 2
cd backend; copy .env.example .env   # optional; uncomment NODE_ENV=development for detailed local errors
npm run dev
```
Use `127.0.0.1`, not `localhost`. Tests: `npm test` (no Python needed); live: `npm run test:live` (Python must be running).
