-- Additive and data-preserving: only column DEFAULTs change. No rows are updated, nothing is dropped.
-- 1) Complexity is no longer entered by users (it still feeds the ML energy-suitability factor), so new tasks get the neutral value.
ALTER TABLE "Task" ALTER COLUMN "complexity" SET DEFAULT 'Moderate';
-- 2) New users default to Asia/Kolkata instead of UTC (a UTC default made the dashboard show the previous date for IST users after midnight).
--    Existing users' stored time zones are NOT changed.
ALTER TABLE "UserPreferences" ALTER COLUMN "timeZone" SET DEFAULT 'Asia/Kolkata';
