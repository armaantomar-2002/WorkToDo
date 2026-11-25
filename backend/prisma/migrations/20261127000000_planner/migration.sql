-- Additive migration: new columns with defaults + new tables. No existing row is modified or removed.

-- 1) Planning preferences (defaults match the product: 09:00-18:00, Mon-Fri, 10-minute break after 90 minutes, 7-day horizon)
ALTER TABLE "UserPreferences"
  ADD COLUMN "workDayStart" VARCHAR(5) NOT NULL DEFAULT '09:00',
  ADD COLUMN "workDayEnd" VARCHAR(5) NOT NULL DEFAULT '18:00',
  ADD COLUMN "workDays" VARCHAR(13) NOT NULL DEFAULT '1,2,3,4,5',
  ADD COLUMN "breaksEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "breakMinutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "breakAfterMinutes" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN "planningHorizonDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "UserPreferences"
  ADD CONSTRAINT "UserPreferences_workDayStart_check" CHECK ("workDayStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "UserPreferences_workDayEnd_check" CHECK ("workDayEnd" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
  ADD CONSTRAINT "UserPreferences_workHours_order_check" CHECK ("workDayEnd" > "workDayStart"),
  ADD CONSTRAINT "UserPreferences_workDays_check" CHECK ("workDays" ~ '^[0-6](,[0-6]){0,6}$'),
  ADD CONSTRAINT "UserPreferences_breakMinutes_check" CHECK ("breakMinutes" BETWEEN 1 AND 120),
  ADD CONSTRAINT "UserPreferences_breakAfterMinutes_check" CHECK ("breakAfterMinutes" BETWEEN 30 AND 480),
  ADD CONSTRAINT "UserPreferences_planningHorizonDays_check" CHECK ("planningHorizonDays" BETWEEN 1 AND 30);

-- 2) Task postponement fields (the original due date is never modified)
ALTER TABLE "Task" ADD COLUMN "postponedUntil" DATE, ADD COLUMN "postponeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD CONSTRAINT "Task_postponeCount_check" CHECK ("postponeCount" >= 0);

-- 3) Fixed appointments + history
CREATE TABLE "Appointment" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "title" VARCHAR(200) NOT NULL, "description" TEXT, "location" VARCHAR(200),
  "startAt" TIMESTAMP(0) NOT NULL, "endAt" TIMESTAMP(0) NOT NULL,
  "preparationBufferMinutes" INTEGER NOT NULL DEFAULT 0, "travelBufferMinutes" INTEGER NOT NULL DEFAULT 0,
  "importance" VARCHAR(10) NOT NULL DEFAULT 'Medium', "consequenceOfDelay" VARCHAR(20) NOT NULL DEFAULT 'Moderate',
  "status" VARCHAR(12) NOT NULL DEFAULT 'scheduled', "cancelledAt" TIMESTAMPTZ(3), "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Appointment_time_order_check" CHECK ("endAt" > "startAt"),
  CONSTRAINT "Appointment_max_length_check" CHECK ("endAt" <= "startAt" + INTERVAL '24 hours'),
  CONSTRAINT "Appointment_buffers_check" CHECK ("preparationBufferMinutes" BETWEEN 0 AND 480 AND "travelBufferMinutes" BETWEEN 0 AND 480),
  CONSTRAINT "Appointment_importance_check" CHECK ("importance" IN ('Critical','High','Medium','Low')),
  CONSTRAINT "Appointment_consequence_check" CHECK ("consequenceOfDelay" IN ('Major','Significant','Moderate','Minor','None')),
  CONSTRAINT "Appointment_status_check" CHECK ("status" IN ('scheduled','cancelled')),
  CONSTRAINT "Appointment_cancel_check" CHECK (("status" = 'cancelled') = ("cancelledAt" IS NOT NULL)),
  CONSTRAINT "Appointment_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "Appointment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Appointment_id_userId_key" ON "Appointment"("id", "userId");
CREATE INDEX "Appointment_userId_status_startAt_idx" ON "Appointment"("userId", "status", "startAt");

CREATE TABLE "AppointmentHistory" (
  "id" UUID NOT NULL, "appointmentId" UUID NOT NULL, "userId" UUID NOT NULL, "action" VARCHAR(12) NOT NULL,
  "previousStartAt" TIMESTAMP(0), "previousEndAt" TIMESTAMP(0), "newStartAt" TIMESTAMP(0), "newEndAt" TIMESTAMP(0),
  "previousTitle" VARCHAR(200), "note" VARCHAR(300), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppointmentHistory_action_check" CHECK ("action" IN ('created','updated','rescheduled','cancelled')),
  CONSTRAINT "AppointmentHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AppointmentHistory_appointment_owner_fkey" FOREIGN KEY ("appointmentId", "userId") REFERENCES "Appointment"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AppointmentHistory_appointmentId_createdAt_idx" ON "AppointmentHistory"("appointmentId", "createdAt");

-- 4) Manually blocked (unavailable) periods
CREATE TABLE "UnavailablePeriod" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "label" VARCHAR(100) NOT NULL, "startAt" TIMESTAMP(0) NOT NULL, "endAt" TIMESTAMP(0) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnavailablePeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UnavailablePeriod_time_order_check" CHECK ("endAt" > "startAt"),
  CONSTRAINT "UnavailablePeriod_max_length_check" CHECK ("endAt" <= "startAt" + INTERVAL '31 days'),
  CONSTRAINT "UnavailablePeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UnavailablePeriod_userId_startAt_idx" ON "UnavailablePeriod"("userId", "startAt");

-- 5) Schedule versions (draft / approved / superseded / rejected) and their blocks
CREATE TABLE "ScheduleVersion" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "versionNumber" INTEGER NOT NULL, "status" VARCHAR(12) NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "mode" VARCHAR(10) NOT NULL, "orderSource" VARCHAR(10) NOT NULL, "horizonFrom" DATE NOT NULL, "horizonTo" DATE NOT NULL,
  "generatedAtLocal" TIMESTAMP(0) NOT NULL, "inputHash" VARCHAR(64) NOT NULL, "basedOnId" UUID, "recommendationRunId" UUID, "summary" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "approvedAt" TIMESTAMPTZ(3), "rejectedAt" TIMESTAMPTZ(3), "supersededAt" TIMESTAMPTZ(3),
  CONSTRAINT "ScheduleVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduleVersion_status_check" CHECK ("status" IN ('draft','approved','superseded','rejected')),
  CONSTRAINT "ScheduleVersion_mode_check" CHECK ("mode" IN ('fresh','minimal','clone')),
  CONSTRAINT "ScheduleVersion_orderSource_check" CHECK ("orderSource" IN ('ml','fallback')),
  CONSTRAINT "ScheduleVersion_horizon_check" CHECK ("horizonTo" >= "horizonFrom"),
  CONSTRAINT "ScheduleVersion_versionNumber_check" CHECK ("versionNumber" >= 1 AND "revision" >= 1),
  CONSTRAINT "ScheduleVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScheduleVersion_id_userId_key" ON "ScheduleVersion"("id", "userId");
CREATE UNIQUE INDEX "ScheduleVersion_userId_versionNumber_key" ON "ScheduleVersion"("userId", "versionNumber");
CREATE INDEX "ScheduleVersion_userId_status_idx" ON "ScheduleVersion"("userId", "status");
-- At most ONE open draft and ONE approved (active) schedule per user: makes concurrent approvals/generations race-safe.
CREATE UNIQUE INDEX "ScheduleVersion_one_draft_per_user" ON "ScheduleVersion"("userId") WHERE "status" = 'draft';
CREATE UNIQUE INDEX "ScheduleVersion_one_approved_per_user" ON "ScheduleVersion"("userId") WHERE "status" = 'approved';

CREATE TABLE "ScheduledBlock" (
  "id" UUID NOT NULL, "scheduleVersionId" UUID NOT NULL, "userId" UUID NOT NULL, "kind" VARCHAR(8) NOT NULL, "taskId" UUID, "taskNameSnapshot" VARCHAR(200),
  "startAt" TIMESTAMP(0) NOT NULL, "endAt" TIMESTAMP(0) NOT NULL, "sessionIndex" INTEGER NOT NULL DEFAULT 1, "sessionCount" INTEGER NOT NULL DEFAULT 1,
  "source" VARCHAR(8) NOT NULL DEFAULT 'engine', "status" VARCHAR(10) NOT NULL DEFAULT 'planned', "reason" TEXT, "warnings" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ScheduledBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledBlock_kind_check" CHECK ("kind" IN ('task','break')),
  CONSTRAINT "ScheduledBlock_kind_task_check" CHECK (("kind" = 'task') = ("taskId" IS NOT NULL)),
  CONSTRAINT "ScheduledBlock_time_order_check" CHECK ("endAt" > "startAt"),
  CONSTRAINT "ScheduledBlock_source_check" CHECK ("source" IN ('engine','kept','user')),
  CONSTRAINT "ScheduledBlock_status_check" CHECK ("status" IN ('planned','skipped','suggested','accepted')),
  CONSTRAINT "ScheduledBlock_session_check" CHECK ("sessionIndex" >= 1 AND "sessionCount" >= "sessionIndex"),
  CONSTRAINT "ScheduledBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScheduledBlock_version_owner_fkey" FOREIGN KEY ("scheduleVersionId", "userId") REFERENCES "ScheduleVersion"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScheduledBlock_task_owner_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScheduledBlock_scheduleVersionId_startAt_idx" ON "ScheduledBlock"("scheduleVersionId", "startAt");
CREATE INDEX "ScheduledBlock_userId_startAt_idx" ON "ScheduledBlock"("userId", "startAt");
CREATE INDEX "ScheduledBlock_taskId_idx" ON "ScheduledBlock"("taskId");

-- 6) Postponement history
CREATE TABLE "TaskPostponement" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "taskId" UUID NOT NULL, "originalDueDate" DATE, "previousPostponedUntil" DATE, "newPostponedUntil" DATE NOT NULL,
  "reason" VARCHAR(200), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskPostponement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskPostponement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPostponement_task_owner_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaskPostponement_taskId_createdAt_idx" ON "TaskPostponement"("taskId", "createdAt");
CREATE INDEX "TaskPostponement_userId_createdAt_idx" ON "TaskPostponement"("userId", "createdAt");
