-- MANUAL ROLLBACK (not run by Prisma). Fixed-time tasks become ordinary flexible tasks; their appointments are kept.
-- After running it, remove the migration row:  DELETE FROM "_prisma_migrations" WHERE migration_name = '20261128000000_fixed_time_tasks';
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_appointmentId_fkey";
DROP INDEX IF EXISTS "Task_appointmentId_key";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "appointmentId";
