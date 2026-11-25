import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarClock, Clock, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Alert, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, FormField, Input, Pagination, Select, Skeleton, useToast } from '../components/ui';
import { useCreateSession, useDeleteSession, usePreferences, useSessions, useUpdateSession } from '../api/hooks';
import { fieldErrorsOf, messageOf } from '../lib/api';
import { formatDateTime, fromInputDateTime, nowLocal, periodForHour, toInputDateTime } from '../lib/format';
import { LEVEL, TIME_PERIOD, type FocusSession, type Level } from '../lib/types';
import { cn } from '../lib/cn';
import { FocusTimerPanel } from '../components/timer/FocusTimerPanel';
import { TimerHistory } from '../components/timer/TimerHistory';

export const sessionSchema = z.object({
  sessionDateTime: z.string().min(1, 'Choose a date and time'),
  availableTimeMinutes: z.number({ invalid_type_error: 'Enter the available minutes' }).int('Use whole minutes').min(1, 'Must be at least 1 minute').max(1440, 'Must be at most 1440 minutes'),
  longestFreeSlotMinutes: z.number({ invalid_type_error: 'Enter the longest free slot' }).int('Use whole minutes').min(0, 'Cannot be negative').max(1440, 'Must be at most 1440 minutes'),
  energyLevel: z.enum(['Low', 'Medium', 'High']), focusLevel: z.enum(['Low', 'Medium', 'High']), currentTimePeriod: z.enum(['Morning', 'Afternoon', 'Evening', 'Night']),
}).refine((v) => v.longestFreeSlotMinutes <= v.availableTimeMinutes, { path: ['longestFreeSlotMinutes'], message: 'Cannot exceed the available time' });
type Values = z.infer<typeof sessionSchema>;

const DOT: Record<Level, string> = { High: 'bg-olive', Medium: 'bg-dusty', Low: 'bg-amber' };

export default function SessionsPage() {
  const [page, setPage] = useState(1);
  const list = useSessions(page);
  const prefs = usePreferences();
  const create = useCreateSession(); const update = useUpdateSession(); const del = useDeleteSession();
  const [editing, setEditing] = useState<FocusSession | null>(null);
  const [deleting, setDeleting] = useState<FocusSession | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const toast = useToast(); const navigate = useNavigate();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(sessionSchema) });

  const blank = (): Values => ({ sessionDateTime: toInputDateTime(nowLocal()), availableTimeMinutes: 60, longestFreeSlotMinutes: 60, energyLevel: prefs.data?.defaultEnergyLevel ?? 'Medium', focusLevel: prefs.data?.defaultFocusLevel ?? 'Medium', currentTimePeriod: periodForHour(new Date().getHours()) });
  useEffect(() => {
    if (editing) reset({ sessionDateTime: toInputDateTime(editing.sessionDateTime), availableTimeMinutes: editing.availableTimeMinutes, longestFreeSlotMinutes: editing.longestFreeSlotMinutes, energyLevel: editing.energyLevel, focusLevel: editing.focusLevel, currentTimePeriod: editing.currentTimePeriod });
    else reset(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, prefs.data, reset]);

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const input = { ...v, sessionDateTime: fromInputDateTime(v.sessionDateTime) };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, patch: input }); else await create.mutateAsync(input);
      toast.success(editing ? 'Session updated' : 'Session saved'); setEditing(null); if (!editing) reset(blank());
    } catch (e) {
      const fields = fieldErrorsOf(e); let handled = false;
      for (const [f, message] of Object.entries(fields)) if (f in v || f === 'sessionDateTime') { setError(f === 'sessionDateTime' ? 'sessionDateTime' : (f as keyof Values), { message }); handled = true; }
      if (!handled) setFormError(messageOf(e));
    }
  });
  const confirmDelete = async () => {
    if (!deleting) return;
    try { await del.mutateAsync(deleting.id); toast.success('Session deleted'); if (editing?.id === deleting.id) setEditing(null); setDeleting(null); } catch (e) { toast.error(messageOf(e)); }
  };

  return (
    <>
      <PageHeader title="Focus Sessions" subtitle="Run a persistent focus timer and plan your sessions." />
      <div className="mb-6 space-y-6"><FocusTimerPanel /><TimerHistory /></div>
      <h2 className="mb-3 font-serif text-xl font-semibold">Planned Sessions</h2>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title={editing ? 'Edit Session' : 'Plan a Session'} />
          <form onSubmit={onSubmit} noValidate className="space-y-4 px-5 pb-5 pt-4" aria-label={editing ? 'Edit session' : 'Plan a session'}>
            {formError && <Alert tone="error">{formError}</Alert>}
            <FormField label="Session Date & Time" htmlFor="sessionDateTime" error={errors.sessionDateTime?.message}><Input id="sessionDateTime" type="datetime-local" icon={CalendarClock} invalid={!!errors.sessionDateTime} {...register('sessionDateTime')} /></FormField>
            <FormField label="Available Time (minutes)" htmlFor="availableTimeMinutes" error={errors.availableTimeMinutes?.message}><Input id="availableTimeMinutes" type="number" min={1} invalid={!!errors.availableTimeMinutes} {...register('availableTimeMinutes', { valueAsNumber: true })} /></FormField>
            <FormField label="Longest Free Slot (minutes)" htmlFor="longestFreeSlotMinutes" error={errors.longestFreeSlotMinutes?.message} hint="The longest uninterrupted stretch you have."><Input id="longestFreeSlotMinutes" type="number" min={0} invalid={!!errors.longestFreeSlotMinutes} hasHint {...register('longestFreeSlotMinutes', { valueAsNumber: true })} /></FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Energy Level" htmlFor="energyLevel" error={errors.energyLevel?.message}><Select id="energyLevel" {...register('energyLevel')}>{LEVEL.map((l) => <option key={l}>{l}</option>)}</Select></FormField>
              <FormField label="Focus Level" htmlFor="focusLevel" error={errors.focusLevel?.message}><Select id="focusLevel" {...register('focusLevel')}>{LEVEL.map((l) => <option key={l}>{l}</option>)}</Select></FormField>
            </div>
            <FormField label="Current Time Period" htmlFor="currentTimePeriod" error={errors.currentTimePeriod?.message}><Select id="currentTimePeriod" {...register('currentTimePeriod')}>{TIME_PERIOD.map((l) => <option key={l}>{l}</option>)}</Select></FormField>
            <div className="flex gap-2"><Button type="submit" block loading={isSubmitting}>{editing ? 'Update Session' : 'Save Session'}</Button>{editing && <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>}</div>
          </form>
        </Card>

        <Card className="self-start">
          <CardHeader title="Recent Sessions" />
          {list.isPending ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            : list.isError ? <ErrorState message={messageOf(list.error)} onRetry={() => list.refetch()} />
            : list.data.items.length === 0 ? <EmptyState icon={Clock} title="No sessions yet" message="Save a session to reuse its context when generating recommendations." />
            : (
              <>
                <ul className="divide-y divide-line px-5 pt-2">
                  {list.data.items.map((s) => (
                    <li key={s.id} className="flex items-start gap-3 py-3">
                      <span className={cn('mt-1.5 h-3 w-3 shrink-0 rounded-full', DOT[s.energyLevel])} role="img" aria-label={`${s.energyLevel} energy`} />
                      <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{formatDateTime(s.sessionDateTime)}</p><p className="text-xs text-muted">{s.availableTimeMinutes} min · {s.energyLevel} · {s.focusLevel} · {s.currentTimePeriod}</p></div>
                      <div className="flex shrink-0 gap-0.5">
                        <button type="button" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Use this session for recommendations" title="Use for recommendations" onClick={() => navigate(`/recommendations?session=${s.id}`)}><Sparkles className="h-4 w-4" /></button>
                        <button type="button" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Edit session ${formatDateTime(s.sessionDateTime)}`} onClick={() => setEditing(s)}><Pencil className="h-4 w-4" /></button>
                        <button type="button" className="rounded p-1.5 text-terracotta hover:bg-terracotta-soft" aria-label={`Delete session ${formatDateTime(s.sessionDateTime)}`} onClick={() => setDeleting(s)}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </li>))}
                </ul>
                <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} noun="sessions" />
              </>)}
        </Card>
      </div>
      <ConfirmDialog open={!!deleting} title="Delete session?" message="Recommendation history that used this session keeps its own copy of the context." loading={del.isPending} onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
    </>
  );
}
