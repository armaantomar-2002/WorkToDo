-- Adds: persistent focus timer (FocusTimer + FocusTimerPause), real task dependencies (TaskDependency), recommendation feedback.
-- Applies on top of 20261124000000_init. Ownership is enforced in the database with composite foreign keys.

-- Composite-FK targets (ownership guarantees)
CREATE UNIQUE INDEX "Task_id_userId_key" ON "Task"("id", "userId");
CREATE UNIQUE INDEX "RecommendationRun_id_userId_key" ON "RecommendationRun"("id", "userId");
CREATE UNIQUE INDEX "RecommendationItem_id_recommendationRunId_key" ON "RecommendationItem"("id", "recommendationRunId");

-- ---------------------------------------------------------------- task dependencies
CREATE TABLE "TaskDependency" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "taskId" UUID NOT NULL,            -- the task that is blocked
    "dependsOnTaskId" UUID NOT NULL,   -- the prerequisite
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");
CREATE INDEX "TaskDependency_userId_idx" ON "TaskDependency"("userId");
CREATE INDEX "TaskDependency_dependsOnTaskId_idx" ON "TaskDependency"("dependsOnTaskId");
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_task_owner_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_prereq_owner_fkey" FOREIGN KEY ("dependsOnTaskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_not_self_check" CHECK ("taskId" <> "dependsOnTaskId");

-- ---------------------------------------------------------------- focus timer
CREATE TABLE "FocusTimer" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "taskId" UUID,
    "taskNameSnapshot" VARCHAR(200),
    "focusSessionId" UUID,
    "status" VARCHAR(10) NOT NULL,                 -- running | paused | finished | cancelled
    "plannedDurationMinutes" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "actualFocusedSeconds" INTEGER,                -- set when finished/cancelled; excludes pauses
    "totalPausedSeconds" INTEGER,                  -- set when finished/cancelled
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "FocusTimer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FocusTimer_userId_startedAt_idx" ON "FocusTimer"("userId", "startedAt");
CREATE INDEX "FocusTimer_userId_status_idx" ON "FocusTimer"("userId", "status");
CREATE INDEX "FocusTimer_taskId_idx" ON "FocusTimer"("taskId");
ALTER TABLE "FocusTimer" ADD CONSTRAINT "FocusTimer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FocusTimer" ADD CONSTRAINT "FocusTimer_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FocusTimer" ADD CONSTRAINT "FocusTimer_focusSessionId_fkey" FOREIGN KEY ("focusSessionId") REFERENCES "FocusSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FocusTimer"
  ADD CONSTRAINT "FocusTimer_status_check" CHECK ("status" IN ('running','paused','finished','cancelled')),
  ADD CONSTRAINT "FocusTimer_planned_check" CHECK ("plannedDurationMinutes" BETWEEN 1 AND 720),
  ADD CONSTRAINT "FocusTimer_nonneg_check" CHECK (("actualFocusedSeconds" IS NULL OR "actualFocusedSeconds" >= 0) AND ("totalPausedSeconds" IS NULL OR "totalPausedSeconds" >= 0)),
  ADD CONSTRAINT "FocusTimer_end_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt"),
  ADD CONSTRAINT "FocusTimer_lifecycle_check" CHECK (
    ("status" IN ('running','paused') AND "endedAt" IS NULL AND "actualFocusedSeconds" IS NULL)
    OR ("status" IN ('finished','cancelled') AND "endedAt" IS NOT NULL AND "actualFocusedSeconds" IS NOT NULL AND "totalPausedSeconds" IS NOT NULL));
-- At most ONE unfinished timer per user, enforced by the database (blocks duplicate/concurrent starts).
CREATE UNIQUE INDEX "FocusTimer_one_active_per_user" ON "FocusTimer"("userId") WHERE "status" IN ('running','paused');

CREATE TABLE "FocusTimerPause" (
    "id" UUID NOT NULL,
    "focusTimerId" UUID NOT NULL,
    "pausedAt" TIMESTAMPTZ(3) NOT NULL,
    "resumedAt" TIMESTAMPTZ(3),
    CONSTRAINT "FocusTimerPause_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FocusTimerPause_focusTimerId_idx" ON "FocusTimerPause"("focusTimerId");
ALTER TABLE "FocusTimerPause" ADD CONSTRAINT "FocusTimerPause_focusTimerId_fkey" FOREIGN KEY ("focusTimerId") REFERENCES "FocusTimer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FocusTimerPause" ADD CONSTRAINT "FocusTimerPause_order_check" CHECK ("resumedAt" IS NULL OR "resumedAt" >= "pausedAt");
-- At most one open pause per timer.
CREATE UNIQUE INDEX "FocusTimerPause_one_open_per_timer" ON "FocusTimerPause"("focusTimerId") WHERE "resumedAt" IS NULL;

-- ---------------------------------------------------------------- recommendation feedback
CREATE TABLE "RecommendationFeedback" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recommendationRunId" UUID NOT NULL,
    "recommendationItemId" UUID NOT NULL,
    "taskId" UUID,
    "feedbackType" VARCHAR(20) NOT NULL,
    "comment" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecommendationFeedback_userId_recommendationItemId_key" ON "RecommendationFeedback"("userId", "recommendationItemId");
CREATE INDEX "RecommendationFeedback_recommendationRunId_idx" ON "RecommendationFeedback"("recommendationRunId");
CREATE INDEX "RecommendationFeedback_taskId_idx" ON "RecommendationFeedback"("taskId");
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_run_owner_fkey" FOREIGN KEY ("recommendationRunId", "userId") REFERENCES "RecommendationRun"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_item_run_fkey" FOREIGN KEY ("recommendationItemId", "recommendationRunId") REFERENCES "RecommendationItem"("id", "recommendationRunId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_type_check" CHECK ("feedbackType" IN ('helpful','not_helpful','already_done','not_relevant'));
