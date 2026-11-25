// Server-state hooks (TanStack Query). Every mutation invalidates exactly the queries whose data it can change.
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  AuthSessionInfo, DashboardSummary, DependencyView, Feedback, FeedbackType, FocusTimer, TimerStartInput, FocusSession, FocusSessionInput, InsightsSessions, InsightsSummary, InsightsTasks, Page, Preferences,
  Appointment, AppointmentHistoryEntry, AppointmentImpact, AppointmentInput, CalendarData, GenerateOptions, PostponeResult, PostponementHistory, ScheduleDiff, ScheduleMeta, ScheduleView, UnavailablePeriod,
  RunDetail, RunInput, RunListItem, Task, TaskFilters, TaskInput, TaskStatus, User,
} from '../lib/types';

const invalidate = (qc: QueryClient, ...roots: string[]) => Promise.all(roots.map((r) => qc.invalidateQueries({ queryKey: [r] })));
const taskChanged = (qc: QueryClient) => invalidate(qc, 'tasks', 'dashboard', 'insights', 'dependencies');

export const useTasks = (filters: TaskFilters) => useQuery({
  queryKey: ['tasks', filters], placeholderData: keepPreviousData,
  queryFn: () => api.get<Page<Task>>('/tasks', { search: filters.search, status: filters.status, importance: filters.importance, sortBy: filters.sortBy, sortOrder: filters.sortOrder, page: filters.page, pageSize: filters.pageSize }),
});
export const useCreateTask = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (input: TaskInput) => api.post<{ task: Task }>('/tasks', input).then((r) => r.task), onSuccess: () => taskChanged(qc) }); };
export const useUpdateTask = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<TaskInput> }) => api.patch<{ task: Task }>(`/tasks/${id}`, patch).then((r) => r.task), onSuccess: () => taskChanged(qc) }); };
export const useSetTaskStatus = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.patch<{ task: Task }>(`/tasks/${id}/status`, { status }).then((r) => r.task), onSuccess: () => taskChanged(qc) }); };
export const useDeleteTask = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api.del(`/tasks/${id}`), onSuccess: () => taskChanged(qc) }); };

export const useSessions = (page: number, pageSize = 10) => useQuery({ queryKey: ['sessions', page, pageSize], placeholderData: keepPreviousData, queryFn: () => api.get<Page<FocusSession>>('/sessions', { page, pageSize }) });
const sessionChanged = (qc: QueryClient) => invalidate(qc, 'sessions', 'dashboard', 'insights', 'history');
export const useCreateSession = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (i: FocusSessionInput) => api.post<{ session: FocusSession }>('/sessions', i).then((r) => r.session), onSuccess: () => sessionChanged(qc) }); };
export const useUpdateSession = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<FocusSessionInput> }) => api.patch<{ session: FocusSession }>(`/sessions/${id}`, patch).then((r) => r.session), onSuccess: () => sessionChanged(qc) }); };
export const useDeleteSession = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api.del(`/sessions/${id}`), onSuccess: () => sessionChanged(qc) }); };

export const useRunRecommendation = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (input: RunInput) => api.post<RunDetail>('/recommendations/runs', input), onSuccess: () => invalidate(qc, 'history', 'dashboard') }); };
export const useHistory = (page: number, enabled = true) => useQuery({ queryKey: ['history', page], enabled, placeholderData: keepPreviousData, queryFn: () => api.get<Page<RunListItem>>('/recommendations/history', { page, pageSize: 8 }) });
export const useRunDetail = (id: string | null) => useQuery({ queryKey: ['history', 'detail', id], enabled: !!id, queryFn: () => api.get<RunDetail>(`/recommendations/history/${id}`) });

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardSummary>('/dashboard/summary') });
export const useInsightsSummary = (range: number) => useQuery({ queryKey: ['insights', 'summary', range], queryFn: () => api.get<InsightsSummary>('/insights/summary', { range }) });
export const useInsightsTasks = (range: number) => useQuery({ queryKey: ['insights', 'tasks', range], queryFn: () => api.get<InsightsTasks>('/insights/tasks', { range }) });
export const useInsightsSessions = (range: number) => useQuery({ queryKey: ['insights', 'sessions', range], queryFn: () => api.get<InsightsSessions>('/insights/sessions', { range }) });

export const usePreferences = (enabled = true) => useQuery({ queryKey: ['preferences'], enabled, queryFn: () => api.get<{ preferences: Preferences }>('/users/preferences').then((r) => r.preferences) });
export const useUpdatePreferences = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (p: Partial<Preferences>) => api.patch<{ preferences: Preferences }>('/users/preferences', p).then((r) => r.preferences), onSuccess: (prefs) => { qc.setQueryData(['preferences'], prefs); return invalidate(qc, 'dashboard', 'insights'); } }); };
export const useUpdateProfile = () => useMutation({ mutationFn: (p: { fullName?: string; email?: string; currentPassword?: string }) => api.patch<{ user: User }>('/users/me', p).then((r) => r.user) });
export const useChangePassword = () => useMutation({ mutationFn: (p: { currentPassword: string; newPassword: string }) => api.post<{ ok: true }>('/auth/change-password', p) });
export const useAuthSessions = () => useQuery({ queryKey: ['auth-sessions'], queryFn: () => api.get<{ sessions: AuthSessionInfo[] }>('/auth/sessions').then((r) => r.sessions) });
export const useRevokeAuthSession = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api.del<{ ok: true; revokedCurrent: boolean }>(`/auth/sessions/${id}`), onSuccess: () => invalidate(qc, 'auth-sessions') }); };
export const useRevokeOtherSessions = () => { const qc = useQueryClient(); return useMutation({ mutationFn: () => api.del<{ revoked: number }>('/auth/sessions'), onSuccess: () => invalidate(qc, 'auth-sessions') }); };

// ---- focus timer (server is the source of truth; the browser only renders)
const timerChanged = (qc: QueryClient) => invalidate(qc, 'timer', 'timer-history', 'dashboard', 'insights', 'tasks');
export const useActiveTimer = () => useQuery({
  queryKey: ['timer', 'active'], refetchOnWindowFocus: true, refetchOnReconnect: true,
  refetchInterval: (q) => (q.state.data ? 30_000 : false), // periodic resync while a timer exists
  queryFn: () => api.get<{ timer: FocusTimer | null }>('/focus-timers/active').then((r) => r.timer),
});
export const useStartTimer = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (i: TimerStartInput) => api.post<{ timer: FocusTimer }>('/focus-timers', i).then((r) => r.timer), onSuccess: (t) => { qc.setQueryData(['timer', 'active'], t); return timerChanged(qc); } }); };
export type TimerAction = 'pause' | 'resume' | 'finish' | 'cancel';
export const useTimerAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, completeTask }: { id: string; action: TimerAction; completeTask?: boolean }) =>
      api.post<{ timer: FocusTimer }>(`/focus-timers/${id}/${action}`, action === 'finish' ? { completeTask: !!completeTask } : {}).then((r) => r.timer),
    onSuccess: (t) => { qc.setQueryData(['timer', 'active'], t.status === 'running' || t.status === 'paused' ? t : null); return timerChanged(qc); },
    onError: () => invalidate(qc, 'timer'), // e.g. 409 because another tab already changed it: resync from the server
  });
};
export const useTimerHistory = (page: number) => useQuery({ queryKey: ['timer-history', page], placeholderData: keepPreviousData, queryFn: () => api.get<Page<FocusTimer>>('/focus-timers', { page, pageSize: 8 }) });

// ---- task dependencies
export const useDependencies = (taskId: string | null) => useQuery({ queryKey: ['dependencies', taskId], enabled: !!taskId, queryFn: () => api.get<DependencyView>(`/tasks/${taskId}/dependencies`) });
export const useAddDependency = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ taskId, dependsOnTaskId }: { taskId: string; dependsOnTaskId: string }) => api.post<DependencyView>(`/tasks/${taskId}/dependencies`, { dependsOnTaskId }), onSuccess: () => taskChanged(qc) }); };
export const useRemoveDependency = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ taskId, prerequisiteId }: { taskId: string; prerequisiteId: string }) => api.del<DependencyView>(`/tasks/${taskId}/dependencies/${prerequisiteId}`), onSuccess: () => taskChanged(qc) }); };

// ---- recommendation feedback
export const useSaveFeedback = () => useMutation({ mutationFn: ({ runId, itemId, feedbackType, comment }: { runId: string; itemId: string; feedbackType: FeedbackType; comment?: string | null }) => api.put<{ feedback: Feedback }>(`/recommendations/runs/${runId}/items/${itemId}/feedback`, { feedbackType, comment: comment ?? null }).then((r) => r.feedback) });
export const useClearFeedback = () => useMutation({ mutationFn: ({ runId, itemId }: { runId: string; itemId: string }) => api.del(`/recommendations/runs/${runId}/items/${itemId}/feedback`) });

// ---------- Planner ----------
const plannerChanged = (qc: QueryClient) => invalidate(qc, 'calendar', 'schedule', 'dashboard');
export const useCalendar = (from: string, to: string) => useQuery({ queryKey: ['calendar', from, to], placeholderData: keepPreviousData, queryFn: () => api.get<CalendarData>('/calendar', { from, to }) });
export const useOpenSchedule = (kind: 'active' | 'draft') => useQuery({ queryKey: ['schedule', kind], queryFn: () => api.get<{ schedule: ScheduleView | null }>(`/schedules/${kind}`).then((r) => r.schedule) });
export const useScheduleList = (enabled = true) => useQuery({ queryKey: ['schedule', 'list'], enabled, queryFn: () => api.get<{ schedules: ScheduleMeta[] }>('/schedules').then((r) => r.schedules) });
export const useScheduleDiff = (id: string | null) => useQuery({ queryKey: ['schedule', 'diff', id], enabled: !!id, queryFn: () => api.get<ScheduleDiff>(`/schedules/${id}/diff`) });
export const useScheduleVersion = (id: string | null) => useQuery({ queryKey: ['schedule', 'version', id], enabled: !!id, queryFn: () => api.get<ScheduleView>(`/schedules/${id}`) });
export const useGenerateDraft = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (o: GenerateOptions) => api.post<ScheduleView>('/schedules/drafts', o), onSuccess: () => plannerChanged(qc) }); };
export const useApproveDraft = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, revision }: { id: string; revision: number }) => api.post<ScheduleView>(`/schedules/${id}/approve`, { revision }), onSuccess: () => plannerChanged(qc) }); };
export const useRejectDraft = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, revision }: { id: string; revision?: number }) => api.post(`/schedules/${id}/reject`, revision ? { revision } : {}), onSuccess: () => plannerChanged(qc) }); };
export const useMoveBlock = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, blockId, start, revision, preview }: { id: string; blockId: string; start: string; revision: number; preview?: boolean }) => api.patch<ScheduleView & { valid: true }>(`/schedules/${id}/blocks/${blockId}`, { start, revision, ...(preview ? { preview: true } : {}) }), onSuccess: (_d, v) => { if (!v.preview) void plannerChanged(qc); } }); };
export const useRemoveBlock = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, blockId, revision }: { id: string; blockId: string; revision: number }) => api.del<ScheduleView>(`/schedules/${id}/blocks/${blockId}`, { query: { revision } }), onSuccess: () => plannerChanged(qc) }); };
export const useAddBreak = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...body }: { id: string; start: string; end: string; revision?: number; replan?: boolean }) => api.post<ScheduleView>(`/schedules/${id}/breaks`, body), onSuccess: () => plannerChanged(qc) }); };
export const useAcceptBreak = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, blockId, revision }: { id: string; blockId: string; revision?: number }) => api.post<ScheduleView>(`/schedules/${id}/breaks/${blockId}/accept`, revision ? { revision } : {}), onSuccess: () => plannerChanged(qc) }); };
export const useSkipBlock = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, blockId }: { id: string; blockId: string }) => api.post<ScheduleView>(`/schedules/${id}/blocks/${blockId}/skip`, {}), onSuccess: () => plannerChanged(qc) }); };

export const useAppointmentHistory = (id: string | null) => useQuery({ queryKey: ['appointment-history', id], enabled: !!id, queryFn: () => api.get<{ history: AppointmentHistoryEntry[] }>(`/appointments/${id}/history`).then((r) => r.history) });
export const useAppointment = (id: string | null) => useQuery({ queryKey: ['appointment', id], enabled: !!id, queryFn: () => api.get<{ appointment: Appointment }>(`/appointments/${id}`).then((r) => r.appointment) });
export const useCreateAppointment = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (i: AppointmentInput) => api.post<{ appointment: Appointment; impact: AppointmentImpact }>('/appointments', i), onSuccess: () => plannerChanged(qc) }); };
export const useUpdateAppointment = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<AppointmentInput> & { revision?: number } }) => api.patch<{ appointment: Appointment; impact: AppointmentImpact }>(`/appointments/${id}`, patch), onSuccess: (_d, v) => { void plannerChanged(qc); void invalidate(qc, 'appointment', 'appointment-history'); void v; } }); };
export const useCancelAppointment = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.post<{ appointment: Appointment; impact: AppointmentImpact }>(`/appointments/${id}/cancel`, reason ? { reason } : {}), onSuccess: () => { void plannerChanged(qc); void invalidate(qc, 'appointment', 'appointment-history'); } }); };
export const useCreateUnavailable = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (i: { label?: string; startAt: string; endAt: string }) => api.post<{ period: UnavailablePeriod }>('/unavailable-periods', i), onSuccess: () => plannerChanged(qc) }); };
export const useRemoveUnavailable = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api.del(`/unavailable-periods/${id}`), onSuccess: () => plannerChanged(qc) }); };
export const usePostpone = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...body }: { id: string; days?: number; reason?: string; confirm?: boolean }) => api.post<PostponeResult>(`/tasks/${id}/postpone`, body), onSuccess: () => { void taskChanged(qc); void plannerChanged(qc); void invalidate(qc, 'postponements'); } }); };
export const usePostponements = (id: string | null) => useQuery({ queryKey: ['postponements', id], enabled: !!id, queryFn: () => api.get<PostponementHistory>(`/tasks/${id}/postponements`) });
export const useUnavailablePeriods = (from: string) => useQuery({ queryKey: ['calendar', 'unavailable', from], enabled: !!from, queryFn: () => api.get<{ periods: UnavailablePeriod[] }>('/unavailable-periods', { from }).then((r) => r.periods) });
