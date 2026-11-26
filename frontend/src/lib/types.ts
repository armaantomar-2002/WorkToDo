// API types. They mirror the backend's public (camelCase) contract exactly.
export type Importance = 'Critical' | 'High' | 'Medium' | 'Low';
export type GoalContribution = 'Essential' | 'High' | 'Medium' | 'Low' | 'No linked goal';
export type ConsequenceOfDelay = 'Major' | 'Significant' | 'Moderate' | 'Minor' | 'None';
export type Complexity = 'Simple' | 'Moderate' | 'Complex';
export type PreferredTime = 'Morning' | 'Afternoon' | 'Evening' | 'Night' | 'Anytime';
export type DependencyStatus = 'No dependency' | 'Ready' | 'Blocked';
export type TaskStatus = 'Pending' | 'In Progress' | 'Completed' | 'Cancelled';
export type TimePeriod = 'Morning' | 'Afternoon' | 'Evening' | 'Night';
export type Level = 'Low' | 'Medium' | 'High';
export type Theme = 'light' | 'dark';
export type NotificationPref = 'all' | 'important' | 'none';
export type TimerStatus = 'running' | 'paused' | 'finished' | 'cancelled';
export type FeedbackType = 'helpful' | 'not_helpful' | 'already_done' | 'not_relevant';
export type Category = 'Do now' | 'Do next' | 'Schedule later';

export interface User { id: string; fullName: string; email: string; isEmailVerified: boolean; createdAt: string }
export interface Preferences { defaultEnergyLevel: Level; defaultFocusLevel: Level; preferredTimePeriod: TimePeriod; themePreference: Theme; notificationPreference: NotificationPref; timeZone: string; workDayStart: string; workDayEnd: string; workDays: number[]; breaksEnabled: boolean; breakMinutes: number; breakAfterMinutes: number; planningHorizonDays: number }
export interface AuthResult { user: User; accessToken: string; expiresIn: number }
export interface AuthSessionInfo { id: string; userAgent: string | null; rememberMe: boolean; lastUsedAt: string | null; expiresAt: string; current: boolean }

export interface Task {
  id: string; taskName: string; description: string | null; startDate: string | null; dueDate: string | null;
  importance: Importance; goalContribution: GoalContribution; consequenceOfDelay: ConsequenceOfDelay; complexity: Complexity;
  estimatedDurationMinutes: number; minimumSessionMinutes: number | null; isSplittable: boolean; preferredTime: PreferredTime;
  postponedUntil?: string | null; postponeCount?: number;
  /** Fixed-time task: the linked appointment holds the only copy of the date/time. Flexible tasks have isFixedTime=false and fixedTime=null. */
  appointmentId?: string | null; isFixedTime?: boolean; fixedTime?: { appointmentId: string; startAt: string; endAt: string; durationMinutes: number } | null;
  dependencyStatus: DependencyStatus; status: TaskStatus; createdAt: string; updatedAt: string; completedAt: string | null;
}
/** dependencyStatus is derived by the server from real task dependencies and is not client-writable. */
/** `complexity` is no longer entered by users: the API defaults new tasks to 'Moderate' and keeps stored values on edit. */
export type TaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'completedAt' | 'dependencyStatus' | 'complexity' | 'appointmentId' | 'isFixedTime' | 'fixedTime'> & {
  /** Fixed-time task: exact start (YYYY-MM-DDTHH:mm) and duration. `null` on an edit turns a fixed task back into a flexible one. */
  fixedTime?: { startAt: string; durationMinutes: number } | null;
};
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }
export interface TaskFilters { search?: string; status?: TaskStatus[]; importance?: Importance[]; sortBy?: string; sortOrder?: 'asc' | 'desc'; page?: number; pageSize?: number }

export interface FocusSession { id: string; sessionDateTime: string; availableTimeMinutes: number; longestFreeSlotMinutes: number; currentTimePeriod: TimePeriod; energyLevel: Level; focusLevel: Level; createdAt: string; updatedAt: string }
export type FocusSessionInput = Omit<FocusSession, 'id' | 'createdAt' | 'updatedAt'>;

export interface RunSession { focusSessionId: string | null; localTime: string; availableTimeMinutes: number; longestFreeSlotMinutes: number; currentTimePeriod: TimePeriod; energyLevel: Level; focusLevel: Level }
export interface RunSummary { totalTasks: number; eligible: number; excluded: number; returned: number; startableNow: number }
export interface Feedback { feedbackType: FeedbackType; comment: string | null; createdAt: string; updatedAt: string }
export interface RankedItem {
  itemId: string; feedback: Feedback | null;
  rank: number; taskId: string | null; taskName: string; taskDeleted: boolean; mlScore: number; category: Category; startableNow: boolean; reason: string;
  urgency: number; importance: number; goalContribution: number; feasibility: number; consequenceOfDelay: number; timingSuitability: number; energySuitability: number;
  dueDate: string | null; estimatedDurationMinutes: number | null;
}
export interface ExcludedItem { taskId: string | null; taskName: string; taskDeleted: boolean; exclusionReason: string }
export interface RunDetail { run: { id: string; createdAt: string; topK: number | null; session: RunSession; summary: RunSummary }; ranked: RankedItem[]; excluded: ExcludedItem[] }
export interface RunListItem { id: string; createdAt: string; topK: number | null; session: RunSession; summary: RunSummary; topRecommendation: { taskName: string; mlScore: number; category: Category; startableNow: boolean } | null }
export interface RunInput { focusSessionId?: string; localTime?: string; availableTimeMinutes?: number; longestFreeSlotMinutes?: number; currentTimePeriod?: TimePeriod; energyLevel?: Level; focusLevel?: Level; topK?: number }

export interface DashboardSummary {
  today: string; timeZone: string; planner?: PlannerSummary | null;
  stats: { totalTasks: number; pendingTasks: number; completedTasks: number; completionPercentage: number };
  todaysRecommendation: { runId: string; generatedAt: string; item: RankedItem } | null;
  todaysFocus: { source: 'session' | 'preferences'; sessionId: string | null; sessionDateTime: string | null; availableTimeMinutes: number | null; energyLevel: Level; focusLevel: Level; currentTimePeriod: TimePeriod };
  recentTasks: Task[]; upcomingDeadlines: Task[]; overdueCount: number;
  activeTimer: FocusTimer | null;
  productivity: { focusedMinutesToday: number; focusedMinutesLast7Days: number; finishedTimersLast7Days: number; completedToday: number; completedLast7Days: number; focusSessionsLast7Days: number; plannedMinutesLast7Days: number; recommendationRunsLast7Days: number };
}
export interface Dist { name: string; count: number }
export interface InsightsSummary { range: number; timeZone: string; totals: { totalTasks: number; completedTasks: number; pendingTasks: number; cancelledTasks: number; completionRate: number; avgFocusMinutes: number; totalFocusedMinutes: number; finishedTimers: number; avgPlannedMinutes: number; totalSessions: number }; inRange: { completed: number; created: number; sessions: number; plannedMinutes: number; focusedMinutes: number; finishedTimers: number } }
export interface InsightsTasks { range: number; byStatus: Dist[]; byImportance: Dist[]; completionTrend: { date: string; completed: number; created: number }[] }
export interface InsightsSessions { range: number; totalSessions: number; avgAvailableMinutes: number; avgLongestFreeSlotMinutes: number; trend: { date: string; sessions: number; plannedMinutes: number; focusedMinutes: number; timers: number }[]; byEnergy: Dist[]; byFocus: Dist[]; byPeriod: Dist[] }

export const IMPORTANCE: Importance[] = ['Critical', 'High', 'Medium', 'Low'];
export const GOAL_CONTRIBUTION: GoalContribution[] = ['Essential', 'High', 'Medium', 'Low', 'No linked goal'];
export const CONSEQUENCE: ConsequenceOfDelay[] = ['Major', 'Significant', 'Moderate', 'Minor', 'None'];
export const COMPLEXITY: Complexity[] = ['Simple', 'Moderate', 'Complex'];
export const PREFERRED_TIME: PreferredTime[] = ['Morning', 'Afternoon', 'Evening', 'Night', 'Anytime'];
export const TASK_STATUS: TaskStatus[] = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
export const TIME_PERIOD: TimePeriod[] = ['Morning', 'Afternoon', 'Evening', 'Night'];
export const LEVEL: Level[] = ['Low', 'Medium', 'High'];

export interface FocusTimer {
  id: string; status: TimerStatus; taskId: string | null; taskName: string | null; focusSessionId: string | null;
  plannedDurationMinutes: number; plannedSeconds: number; startedAt: string; endedAt: string | null;
  elapsedSeconds: number; pausedSeconds: number; remainingSeconds: number; overtimeSeconds: number; isOvertime: boolean;
  pauses: { pausedAt: string; resumedAt: string | null }[]; serverNow: string;
}
export interface TimerStartInput { taskId?: string | null; plannedDurationMinutes?: number; focusSessionId?: string | null }
export interface DependencyItem { id: string; taskName: string; status: TaskStatus; dueDate: string | null; isBlocking: boolean }
export interface DependencyView { taskId: string; dependencyStatus: DependencyStatus; prerequisites: DependencyItem[]; dependents: { id: string; taskName: string; status: TaskStatus }[] }
export const FEEDBACK_LABEL: Record<FeedbackType, string> = { helpful: 'Helpful', not_helpful: 'Not helpful', already_done: 'Already done', not_relevant: 'Not relevant' };

// ---------- Planner ----------
export type AppointmentStatus = 'scheduled' | 'cancelled';
export interface Appointment {
  id: string; title: string; description: string | null; location: string | null; startAt: string; endAt: string; durationMinutes: number;
  preparationBufferMinutes: number; travelBufferMinutes: number; importance: Importance; consequenceOfDelay: ConsequenceOfDelay; status: AppointmentStatus; revision: number;
}
export interface CalendarAppointment { id: string; title: string; startAt: string; endAt: string; location: string | null; preparationBufferMinutes: number; travelBufferMinutes: number; importance: Importance; status: AppointmentStatus }
export interface AppointmentInput { title: string; description?: string | null; location?: string | null; startAt: string; endAt: string; preparationBufferMinutes: number; travelBufferMinutes: number; importance: Importance; consequenceOfDelay: ConsequenceOfDelay }
export interface AppointmentHistoryEntry { id: string; action: 'created' | 'updated' | 'rescheduled' | 'cancelled'; previousStartAt: string | null; previousEndAt: string | null; newStartAt: string | null; newEndAt: string | null; previousTitle: string | null; note: string | null; createdAt: string }
export interface AppointmentImpact { approvedBlocks: number; draftBlocks: number; recalculationSuggested: boolean }
export interface UnavailablePeriod { id: string; label: string | null; startAt: string; endAt: string }
export type BlockKind = 'task' | 'break';
export type BlockStatus = 'planned' | 'suggested' | 'accepted' | 'skipped' | 'completed';
export interface PlanBlock { id: string; kind: BlockKind; taskId: string | null; taskName: string; start: string; end: string; durationMinutes: number; sessionIndex: number; sessionCount: number; source: string; status: BlockStatus; reason: string | null; warnings: string[] }
export interface CalendarBlock extends Omit<PlanBlock, 'reason' | 'warnings'> { scheduleVersionId: string; reason?: string | null; warnings?: string[] }
export interface CalendarDay { date: string; working: { start: string; end: string } | null; freeMinutes: number; plannedMinutes: number; actualMinutes: number; appointmentCount: number; deadlineCount: number; completedCount: number }
export interface CalendarData {
  range: { from: string; to: string }; today: string; now: string; timeZone: string; workingHours: { start: string; end: string; days: number[] }; days: CalendarDay[];
  appointments: CalendarAppointment[]; unavailable: UnavailablePeriod[]; approvedBlocks: CalendarBlock[]; draftBlocks: CalendarBlock[];
  deadlines: { taskId: string; taskName: string; dueDate: string; status: TaskStatus; importance: Importance }[]; completions: { taskId: string; taskName: string; completedOn: string }[];
  actualSessions: { id: string; taskId: string | null; taskName: string | null; start: string; end: string | null; minutes: number; plannedMinutes: number }[];
  hasDraft: boolean; hasApproved: boolean; draftId: string | null; approvedId: string | null;
}
export type ScheduleStatus = 'draft' | 'approved' | 'rejected' | 'superseded';
export interface ScheduleMeta { id: string; versionNumber: number; status: ScheduleStatus; revision: number; mode: string; orderSource: 'ml' | 'fallback'; horizonFrom: string; horizonTo: string; generatedAt: string; createdAt: string; approvedAt: string | null; rejectedAt: string | null; supersededAt: string | null; basedOnId: string | null; recommendationRunId?: string | null }
export interface ScheduleProblem { severity: 'error' | 'warning'; code: string; message: string; taskId?: string | null }
export interface UnscheduledTask { taskId: string; taskName: string; remainingMinutes: number; scheduledMinutes: number; code: string; message: string }
export type TimelineKind = 'task' | 'fixed' | 'break';
/** One entry of the single authoritative schedule order. The Recommendations page and the Planner render exactly this list. */
export interface TimelineItem {
  key: string; kind: TimelineKind; blockId: string | null; taskId: string | null; appointmentId: string | null; title: string; start: string; end: string; durationMinutes: number;
  sessionIndex: number; sessionCount: number; status: string; source: string; reason: string | null; warnings: string[]; prerequisites: { taskId: string; taskName: string; status: TaskStatus }[];
}
export interface Infeasibility {
  code: 'infeasible_before_fixed' | 'infeasible_before_deadline'; constraint: { kind: 'fixed' | 'due'; label: string; at: string }; requiredMinutes: number; availableMinutes: number; shortfallMinutes: number;
  tasks: { taskId: string; taskName: string; remainingMinutes: number; scheduled: boolean }[]; message: string; alternatives: string[];
}
export interface ScheduleView {
  timeline: TimelineItem[]; infeasibilities: Infeasibility[];
  schedule: ScheduleMeta; blocks: PlanBlock[]; appointments: CalendarAppointment[]; unavailable: UnavailablePeriod[]; problems: ScheduleProblem[]; unscheduled: UnscheduledTask[]; skipped: unknown[];
  stale: { isStale: boolean; changed: string[] } | null; needsRecalculation: boolean;
  taskSummaries: { taskId: string; taskName: string; estimatedMinutes: number; completedMinutes: number; remainingMinutes: number; scheduledMinutes: number }[];
  freeSlots: { start: string; end: string; durationMinutes: number }[]; workingHours: { start: string; end: string; days: number[] }; timeZone: string; now: string; notes: { ml: string | null };
  replanned?: string[]; valid?: boolean;
}
export interface ScheduleDiff { added: PlanBlock[]; removed: PlanBlock[]; unchanged: number }
export interface GenerateOptions { mode?: 'minimal' | 'fresh' | 'clone'; useMl?: boolean; replace?: boolean; energyLevel?: Level; focusLevel?: Level }
export interface MovePreview { valid: true; preview: unknown }
export interface PostponeResult { postponement: { id: string; newPostponedUntil: string | null; reason: string | null; createdAt: string }; task: { id: string; dueDate: string | null; postponedUntil: string; postponeCount: number }; needsRecalculation: boolean; pastDeadline: boolean }
export interface PostponementHistory { postponeCount: number; history: { id: string; originalDueDate: string | null; previousPostponedUntil: string | null; newPostponedUntil: string | null; reason: string | null; createdAt: string }[] }
export interface PlannerSummary {
  today: string; now: string; scheduleStatus: 'none' | 'approved' | 'needs_recalculation'; hasDraft: boolean; draftId: string | null; approvedId: string | null;
  nextBlock: CalendarBlock | null; nextAppointment: { id: string; title: string; startAt: string; endAt: string; location: string | null } | null; todaysBlocks: CalendarBlock[]; appointmentsToday: CalendarAppointment[];
  dueToday: { taskId: string; taskName: string }[]; plannedMinutesToday: number; actualMinutesToday: number; freeMinutesToday: number; workingToday: boolean; unscheduledCount: number | null; completedToday: number;
}
