-- Additive migration: links a fixed-time task to its Appointment. The appointment remains the only source of the date/time.
-- Existing tasks get NULL = flexible (unchanged behaviour). No row is modified.
ALTER TABLE "Task" ADD COLUMN "appointmentId" UUID;
CREATE UNIQUE INDEX "Task_appointmentId_key" ON "Task"("appointmentId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
