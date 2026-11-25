// Settings → Availability: working hours/days, automatic breaks, planning horizon and unavailable periods.
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError, messageOf } from '../../lib/api';
import { useCreateUnavailable, usePreferences, useRemoveUnavailable, useUnavailablePeriods, useUpdatePreferences } from '../../api/hooks';
import { Alert, Button, Card, CardHeader, Checkbox, EmptyState, ErrorState, FormField, Input, Skeleton, useToast } from '../ui';
import { DEFAULT_TIME_ZONE, dateKeyInZone, safeZone } from '../../lib/clock';
import { validateAvailability, type AvailabilityForm as F } from '../../lib/plannerForms';
import { WEEKDAYS, fmtDay, fmtTime, minutesBetween } from '../../lib/planner';

const ORDER = [1, 2, 3, 4, 5, 6, 0];
export function AvailabilityTab() {
  const prefs = usePreferences(); const update = useUpdatePreferences(); const toast = useToast();
  const [f, setF] = useState<F | null>(null); const [errors, setErrors] = useState<Record<string, string>>({}); const [serverError, setServerError] = useState<string | null>(null);
  useEffect(() => { const p = prefs.data; if (p) setF({ start: p.workDayStart, end: p.workDayEnd, days: p.workDays, breaksEnabled: p.breaksEnabled, breakMinutes: String(p.breakMinutes), breakAfter: String(p.breakAfterMinutes), horizon: String(p.planningHorizonDays) }); }, [prefs.data]);
  if (prefs.isPending || !f) return <Skeleton className="h-72" />;
  if (prefs.isError) return <Card><ErrorState message={messageOf(prefs.error)} onRetry={() => prefs.refetch()} /></Card>;
  const set = <K extends keyof F>(k: K, v: F[K]) => setF((p) => (p ? { ...p, [k]: v } : p));
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); const v = validateAvailability(f); setErrors(v); setServerError(null); if (Object.keys(v).length) return;
    try { await update.mutateAsync({ workDayStart: f.start, workDayEnd: f.end, workDays: [...f.days].sort(), breaksEnabled: f.breaksEnabled, breakMinutes: Number(f.breakMinutes), breakAfterMinutes: Number(f.breakAfter), planningHorizonDays: Number(f.horizon) }); toast.success('Availability saved. Existing schedules are not changed until you re-plan.'); }
    catch (e) { setServerError(e instanceof ApiError ? messageOf(e) : 'Could not save'); }
  };
  return (
    <div className="space-y-6">
      <Card><CardHeader title="Working hours" />
        <form onSubmit={submit} noValidate className="grid max-w-2xl gap-4 px-5 pb-5 pt-4 sm:grid-cols-2" aria-label="Availability">
          {serverError && <div className="sm:col-span-2"><Alert tone="error">{serverError}</Alert></div>}
          <FormField label="Day starts" htmlFor="workDayStart" error={errors.start}><Input id="workDayStart" type="time" value={f.start} invalid={!!errors.start} onChange={(e) => set('start', e.target.value)} /></FormField>
          <FormField label="Day ends" htmlFor="workDayEnd" error={errors.end}><Input id="workDayEnd" type="time" value={f.end === '24:00' ? '23:59' : f.end} invalid={!!errors.end} onChange={(e) => set('end', e.target.value)} /></FormField>
          <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-sm font-medium">Working days</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">{ORDER.map((d) => <Checkbox key={d} label={WEEKDAYS[d]} checked={f.days.includes(d)} onChange={(e) => set('days', e.target.checked ? [...f.days, d] : f.days.filter((x) => x !== d))} />)}</div>
            {errors.days && <p role="alert" className="mt-1 text-xs text-terracotta-ink">{errors.days}</p>}</fieldset>
          <div className="sm:col-span-2"><Checkbox label="Suggest short breaks during long work stretches" checked={f.breaksEnabled} onChange={(e) => set('breaksEnabled', e.target.checked)} /></div>
          <FormField label="Break length (minutes)" htmlFor="breakMinutes" error={errors.breakMinutes}><Input id="breakMinutes" type="number" min={5} max={60} step={5} disabled={!f.breaksEnabled} value={f.breakMinutes} onChange={(e) => set('breakMinutes', e.target.value)} /></FormField>
          <FormField label="Suggest a break after (minutes of work)" htmlFor="breakAfter" error={errors.breakAfter}><Input id="breakAfter" type="number" min={30} max={240} step={5} disabled={!f.breaksEnabled} value={f.breakAfter} onChange={(e) => set('breakAfter', e.target.value)} /></FormField>
          <FormField label="Plan ahead (days)" htmlFor="horizon" error={errors.horizon} hint="How many days a generated schedule covers."><Input id="horizon" type="number" min={1} max={14} hasHint value={f.horizon} onChange={(e) => set('horizon', e.target.value)} /></FormField>
          <div className="sm:col-span-2"><Button type="submit" loading={update.isPending}>Save availability</Button></div>
        </form></Card>
      <UnavailableCard timeZone={prefs.data.timeZone} />
    </div>
  );
}

function UnavailableCard({ timeZone }: { timeZone: string }) {
  const toast = useToast(); const today = dateKeyInZone(new Date(), safeZone(timeZone || DEFAULT_TIME_ZONE));
  const list = useUnavailablePeriods(today); const create = useCreateUnavailable(); const remove = useRemoveUnavailable();
  const [label, setLabel] = useState(''); const [start, setStart] = useState(`${today}T09:00`); const [end, setEnd] = useState(`${today}T10:00`); const [err, setErr] = useState<string | null>(null);
  const add = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null);
    if (!start || !end || minutesBetween(start, end) <= 0) { setErr('The end must be after the start.'); return; }
    try { await create.mutateAsync({ label: label.trim() || undefined, startAt: start, endAt: end }); setLabel(''); toast.success('Unavailable period added'); } catch (e) { setErr(messageOf(e)); }
  };
  return (
    <Card><CardHeader title="Unavailable periods" />
      <div className="px-5 pb-5 pt-4">
        <p className="mb-3 text-sm text-muted">Time you cannot work (travel, exams, leave). Nothing will be scheduled then.</p>
        <form onSubmit={add} className="grid max-w-2xl gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" aria-label="Add unavailable period">
          <FormField label="Label" htmlFor="un-label"><Input id="un-label" value={label} maxLength={100} placeholder="Exam" onChange={(e) => setLabel(e.target.value)} /></FormField>
          <FormField label="From" htmlFor="un-start"><Input id="un-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
          <FormField label="To" htmlFor="un-end"><Input id="un-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></FormField>
          <div className="flex items-end"><Button type="submit" loading={create.isPending}>Add</Button></div>
        </form>
        {err && <Alert tone="error" className="mt-3">{err}</Alert>}
        <div className="mt-4">{list.isPending ? <Skeleton className="h-12" /> : list.isError ? <ErrorState message={messageOf(list.error)} onRetry={() => list.refetch()} /> : list.data.length === 0 ? <EmptyState title="No unavailable periods" message="Add one above when you know you will be away." /> : (
          <ul className="divide-y divide-line text-sm">{list.data.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-2"><span className="font-medium">{u.label ?? 'Unavailable'}</span><span className="text-muted">{fmtDay(u.startAt.slice(0, 10))} {fmtTime(u.startAt)} → {fmtDay(u.endAt.slice(0, 10))} {fmtTime(u.endAt)}</span>
              <button type="button" className="ml-auto rounded p-1.5 text-terracotta hover:bg-terracotta-soft" aria-label={`Remove ${u.label ?? 'unavailable period'}`} disabled={remove.isPending} onClick={async () => { try { await remove.mutateAsync(u.id); toast.success('Removed'); } catch (e) { toast.error(messageOf(e)); } }}><Trash2 className="h-4 w-4" /></button></li>))}</ul>)}</div>
      </div></Card>
  );
}
