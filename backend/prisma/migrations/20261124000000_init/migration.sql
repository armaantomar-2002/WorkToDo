-- WorkToDo initial schema (matches prisma/schema.prisma). CHECK constraints mirror the Python engine's allowed values.

CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserPreferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "defaultEnergyLevel" VARCHAR(10) NOT NULL DEFAULT 'Medium',
    "defaultFocusLevel" VARCHAR(10) NOT NULL DEFAULT 'Medium',
    "preferredTimePeriod" VARCHAR(10) NOT NULL DEFAULT 'Morning',
    "themePreference" VARCHAR(10) NOT NULL DEFAULT 'light',
    "notificationPreference" VARCHAR(10) NOT NULL DEFAULT 'important',
    "timeZone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(64) NOT NULL,
    "rememberMe" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "replacedById" UUID,
    "lastUsedAt" TIMESTAMPTZ(3),
    "userAgent" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "taskName" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "startDate" DATE,
    "dueDate" DATE,
    "importance" VARCHAR(10) NOT NULL,
    "importanceRank" INTEGER NOT NULL,
    "goalContribution" VARCHAR(20) NOT NULL,
    "consequenceOfDelay" VARCHAR(20) NOT NULL,
    "complexity" VARCHAR(10) NOT NULL,
    "estimatedDurationMinutes" INTEGER NOT NULL,
    "minimumSessionMinutes" INTEGER,
    "isSplittable" BOOLEAN NOT NULL DEFAULT false,
    "preferredTime" VARCHAR(10) NOT NULL DEFAULT 'Anytime',
    "dependencyStatus" VARCHAR(20) NOT NULL DEFAULT 'No dependency',
    "status" VARCHAR(20) NOT NULL DEFAULT 'Pending',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FocusSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionDateTime" TIMESTAMP(0) NOT NULL,
    "availableTimeMinutes" INTEGER NOT NULL,
    "longestFreeSlotMinutes" INTEGER NOT NULL,
    "currentTimePeriod" VARCHAR(10) NOT NULL,
    "energyLevel" VARCHAR(10) NOT NULL,
    "focusLevel" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "FocusSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationRun" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "focusSessionId" UUID,
    "sessionDateTime" TIMESTAMP(0) NOT NULL,
    "availableTimeMinutes" INTEGER NOT NULL,
    "longestFreeSlotMinutes" INTEGER NOT NULL,
    "currentTimePeriod" VARCHAR(10) NOT NULL,
    "energyLevel" VARCHAR(10) NOT NULL,
    "focusLevel" VARCHAR(10) NOT NULL,
    "topK" INTEGER,
    "totalTasks" INTEGER NOT NULL,
    "eligibleTasks" INTEGER NOT NULL,
    "excludedTasks" INTEGER NOT NULL,
    "returnedTasks" INTEGER NOT NULL,
    "startableTasks" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationItem" (
    "id" UUID NOT NULL,
    "recommendationRunId" UUID NOT NULL,
    "taskId" UUID,
    "taskNameSnapshot" VARCHAR(200) NOT NULL,
    "taskSnapshot" JSONB NOT NULL,
    "rank" INTEGER NOT NULL,
    "mlScore" DOUBLE PRECISION NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "startableNow" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "urgency" DOUBLE PRECISION NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL,
    "goalContribution" DOUBLE PRECISION NOT NULL,
    "feasibility" DOUBLE PRECISION NOT NULL,
    "consequenceOfDelay" DOUBLE PRECISION NOT NULL,
    "timingSuitability" DOUBLE PRECISION NOT NULL,
    "energySuitability" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "RecommendationItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationExclusion" (
    "id" UUID NOT NULL,
    "recommendationRunId" UUID NOT NULL,
    "taskId" UUID,
    "taskNameSnapshot" VARCHAR(200) NOT NULL,
    "taskSnapshot" JSONB NOT NULL,
    "exclusionReason" VARCHAR(100) NOT NULL,
    CONSTRAINT "RecommendationExclusion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "UserPreferences_userId_key" ON "UserPreferences"("userId");
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_familyId_idx" ON "AuthSession"("familyId");
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "Task_userId_deletedAt_status_idx" ON "Task"("userId", "deletedAt", "status");
CREATE INDEX "Task_userId_deletedAt_dueDate_idx" ON "Task"("userId", "deletedAt", "dueDate");
CREATE INDEX "Task_userId_deletedAt_createdAt_idx" ON "Task"("userId", "deletedAt", "createdAt");
CREATE INDEX "Task_userId_completedAt_idx" ON "Task"("userId", "completedAt");
CREATE INDEX "FocusSession_userId_sessionDateTime_idx" ON "FocusSession"("userId", "sessionDateTime");
CREATE INDEX "RecommendationRun_userId_createdAt_idx" ON "RecommendationRun"("userId", "createdAt");
CREATE INDEX "RecommendationRun_focusSessionId_idx" ON "RecommendationRun"("focusSessionId");
CREATE UNIQUE INDEX "RecommendationItem_recommendationRunId_rank_key" ON "RecommendationItem"("recommendationRunId", "rank");
CREATE UNIQUE INDEX "RecommendationItem_recommendationRunId_taskId_key" ON "RecommendationItem"("recommendationRunId", "taskId");
CREATE INDEX "RecommendationItem_taskId_idx" ON "RecommendationItem"("taskId");
CREATE UNIQUE INDEX "RecommendationExclusion_recommendationRunId_taskId_key" ON "RecommendationExclusion"("recommendationRunId", "taskId");
CREATE INDEX "RecommendationExclusion_taskId_idx" ON "RecommendationExclusion"("taskId");

ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_focusSessionId_fkey" FOREIGN KEY ("focusSessionId") REFERENCES "FocusSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecommendationItem" ADD CONSTRAINT "RecommendationItem_recommendationRunId_fkey" FOREIGN KEY ("recommendationRunId") REFERENCES "RecommendationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationItem" ADD CONSTRAINT "RecommendationItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecommendationExclusion" ADD CONSTRAINT "RecommendationExclusion_recommendationRunId_fkey" FOREIGN KEY ("recommendationRunId") REFERENCES "RecommendationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationExclusion" ADD CONSTRAINT "RecommendationExclusion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain CHECK constraints (not representable in schema.prisma; values are identical to the Python engine's contract).
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_importance_check" CHECK ("importance" IN ('Critical','High','Medium','Low')),
  ADD CONSTRAINT "Task_importanceRank_check" CHECK ("importanceRank" BETWEEN 1 AND 4),
  ADD CONSTRAINT "Task_goalContribution_check" CHECK ("goalContribution" IN ('Essential','High','Medium','Low','No linked goal')),
  ADD CONSTRAINT "Task_consequenceOfDelay_check" CHECK ("consequenceOfDelay" IN ('Major','Significant','Moderate','Minor','None')),
  ADD CONSTRAINT "Task_complexity_check" CHECK ("complexity" IN ('Simple','Moderate','Complex')),
  ADD CONSTRAINT "Task_preferredTime_check" CHECK ("preferredTime" IN ('Morning','Afternoon','Evening','Night','Anytime')),
  ADD CONSTRAINT "Task_dependencyStatus_check" CHECK ("dependencyStatus" IN ('No dependency','Ready','Blocked')),
  ADD CONSTRAINT "Task_status_check" CHECK ("status" IN ('Pending','In Progress','Completed','Cancelled')),
  ADD CONSTRAINT "Task_duration_check" CHECK ("estimatedDurationMinutes" > 0),
  ADD CONSTRAINT "Task_minimumSession_check" CHECK ("minimumSessionMinutes" IS NULL OR ("minimumSessionMinutes" > 0 AND "minimumSessionMinutes" <= "estimatedDurationMinutes")),
  ADD CONSTRAINT "Task_dates_check" CHECK ("startDate" IS NULL OR "dueDate" IS NULL OR "dueDate" >= "startDate");
ALTER TABLE "FocusSession"
  ADD CONSTRAINT "FocusSession_period_check" CHECK ("currentTimePeriod" IN ('Morning','Afternoon','Evening','Night')),
  ADD CONSTRAINT "FocusSession_energy_check" CHECK ("energyLevel" IN ('Low','Medium','High')),
  ADD CONSTRAINT "FocusSession_focus_check" CHECK ("focusLevel" IN ('Low','Medium','High')),
  ADD CONSTRAINT "FocusSession_minutes_check" CHECK ("availableTimeMinutes" >= 0 AND "longestFreeSlotMinutes" >= 0 AND "longestFreeSlotMinutes" <= "availableTimeMinutes");
ALTER TABLE "UserPreferences"
  ADD CONSTRAINT "UserPreferences_energy_check" CHECK ("defaultEnergyLevel" IN ('Low','Medium','High')),
  ADD CONSTRAINT "UserPreferences_focus_check" CHECK ("defaultFocusLevel" IN ('Low','Medium','High')),
  ADD CONSTRAINT "UserPreferences_period_check" CHECK ("preferredTimePeriod" IN ('Morning','Afternoon','Evening','Night')),
  ADD CONSTRAINT "UserPreferences_theme_check" CHECK ("themePreference" IN ('light','dark')),
  ADD CONSTRAINT "UserPreferences_notifications_check" CHECK ("notificationPreference" IN ('all','important','none'));
ALTER TABLE "RecommendationItem"
  ADD CONSTRAINT "RecommendationItem_rank_check" CHECK ("rank" >= 1),
  ADD CONSTRAINT "RecommendationItem_score_check" CHECK ("mlScore" >= 0 AND "mlScore" <= 100);
