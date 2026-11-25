import { useEffect, useState } from 'react';
import { ApiError, messageOf } from '../../lib/api';
import { useAppointment, useAppointmentHistory, useCancelAppointment, useCreateAppointment, useUpdateAppointment } from '../../api/hooks';
import { Alert, Button, ConfirmDialog, FormField, Input, Modal, Select, Skeleton, Textarea, useToast } from '../ui';
import { CONSEQUENCE, IMPORTANCE, type Appointment, type AppointmentInput, type CalendarAppointment, type ConsequenceOfDelay, type Importance } from '../../lib/types';
import { fmtTime, minutesBetween, shiftWall } from '../../lib/planner';
import { validateAppointmentForm, type Form } from '../../lib/plannerForms';

export type ApptTarget = { mode: 'create'; startAt: string } | { mode: 'edit'; appt: CalendarAppointment | Appointment };
const toForm = (t: ApptTarget): Form => t.mode === 'create'
  ? { title: '', location: '', description: '', startAt: t.startAt, endAt: shiftWall(t.startAt, 60), prep: '0', travel: '0', importance: 'Medium', consequence: 'Moderate' }
  : { title: t.appt.title, location: t.appt.location ?? '', description: 'description' in t.appt ? t.appt.description ?? '' : '', startAt: t.appt.startAt, endAt: t.appt.endAt, prep: String(t.appt.preparationBufferMinutes), travel: String(t.appt.travelBufferMinutes), importance: t.appt.importance, consequence: 'consequenceOfDelay' in t.appt ? t.appt.consequenceOfDelay : 'Moderate' };

export function AppointmentModal({ target, onClose }: { target: ApptTarget | null; onClose: () => void }) {
  const toast = useToast(); const create = useCreateAppointment(); const update = useUpdateAppointment(); const cancel = useCancelAppointment();
  const [f, setF] = useState<Form | null>(null); const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({}); const [serverError, setServerError] = useState<string | null>(null); const [confirmCancel, setConfirmCancel] = useState(false);
  const editId = target?.mode === 'edit' ? target.appt.id : null; const full = useAppointment(editId); const editing: Appointment | null = full.data ?? null; const history = useAppointmentHistory(editing?.id ?? null); const cancelled = editing?.status === 'cancelled';
  useEffect(() => { if (!target) { setF(null); return; } if (target.mode === 'create') setF(toForm(target)); setErrors({}); setServerError(null); }, [target]);
  useEffect(() => { if (full.data) setF(toForm({ mode: 'edit', appt: full.data })); }, [full.data?.id, full.data?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return null;
  if (target.mode === 'edit' && !f) return <Modal open onClose={onClose} title="Appointment">{full.isError ? <Alert tone="error">{messageOf(full.error)}</Alert> : <Skeleton className="h-40" />}</Modal>;
  if (!f) return null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => (p ? { ...p, [k]: v } : p));
  const body = (): AppointmentInput => ({ title: f.title.trim(), location: f.location.trim() || null, description: f.description.trim() || null, startAt: f.startAt, endAt: f.endAt, preparationBufferMinutes: Number(f.prep), travelBufferMinutes: Number(f.travel), importance: f.importance, consequenceOfDelay: f.consequence });
  const fail = (e: unknown) => { setServerError(e instanceof ApiError && e.code === 'appointment_conflict' ? `${e.message}` : messageOf(e)); };
  const impactNote = (n: { approvedBlocks: number; recalculationSuggested: boolean }) => (n.recalculationSuggested ? ` ${n.approvedBlocks} planned session(s) are affected — generate a new draft to re-plan them.` : '');
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); const v = validateAppointmentForm(f); setErrors(v); setServerError(null); if (Object.keys(v).length) return;
    try {
      if (editing) { const r = await update.mutateAsync({ id: editing.id, patch: { ...body(), revision: editing.revision } }); toast.success(`Appointment updated.${impactNote(r.impact)}`); }
      else { const r = await create.mutateAsync(body()); toast.success(`Appointment added.${impactNote(r.impact)}`); }
      onClose();
    } catch (e) { fail(e); }
  };
  const busy = create.isPending || update.isPending;
  return (
    <>
      <Modal open onClose={onClose} title={editing ? (cancelled ? 'Cancelled appointment' : 'Edit appointment') : 'New appointment'} wide
        footer={<>
          {editing && !cancelled && <Button variant="danger" onClick={() => setConfirmCancel(true)} className="mr-auto">Cancel appointment</Button>}
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {!cancelled && <Button type="submit" form="appointment-form" loading={busy}>{editing ? 'Save changes' : 'Add appointment'}</Button>}
        </>}>
        <form id="appointment-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2" aria-label="Appointment">
          {serverError && <div className="sm:col-span-2"><Alert tone="error">{serverError}</Alert></div>}
          {cancelled && <div className="sm:col-span-2"><Alert tone="info">This appointment was cancelled. Its time is free for planning again.</Alert></div>}
          <FormField label="Title" htmlFor="appt-title" error={errors.title} className="sm:col-span-2"><Input id="appt-title" value={f.title} disabled={cancelled} invalid={!!errors.title} onChange={(e) => set('title', e.target.value)} maxLength={120} /></FormField>
          <FormField label="Starts" htmlFor="appt-start" error={errors.startAt}><Input id="appt-start" type="datetime-local" step={300} disabled={cancelled} value={f.startAt} invalid={!!errors.startAt} onChange={(e) => { const dur = /^\d{4}/.test(f.startAt) && /^\d{4}/.test(f.endAt) ? minutesBetween(f.startAt, f.endAt) : 60; set('startAt', e.target.value); if (e.target.value && dur > 0) set('endAt', shiftWall(e.target.value, dur)); }} /></FormField>
          <FormField label="Ends" htmlFor="appt-end" error={errors.endAt}><Input id="appt-end" type="datetime-local" step={300} disabled={cancelled} value={f.endAt} invalid={!!errors.endAt} onChange={(e) => set('endAt', e.target.value)} /></FormField>
          <FormField label="Location" htmlFor="appt-location"><Input id="appt-location" value={f.location} disabled={cancelled} onChange={(e) => set('location', e.target.value)} maxLength={200} /></FormField>
          <FormField label="Importance" htmlFor="appt-importance"><Select id="appt-importance" value={f.importance} disabled={cancelled} onChange={(e) => set('importance', e.target.value as Importance)}>{IMPORTANCE.map((x) => <option key={x}>{x}</option>)}</Select></FormField>
          <FormField label="Preparation time (minutes)" htmlFor="appt-prep" error={errors.prep} hint="Kept free before the appointment."><Input id="appt-prep" type="number" min={0} max={480} step={5} hasHint disabled={cancelled} value={f.prep} invalid={!!errors.prep} onChange={(e) => set('prep', e.target.value)} /></FormField>
          <FormField label="Travel time (minutes)" htmlFor="appt-travel" error={errors.travel} hint="Kept free before and after."><Input id="appt-travel" type="number" min={0} max={480} step={5} hasHint disabled={cancelled} value={f.travel} invalid={!!errors.travel} onChange={(e) => set('travel', e.target.value)} /></FormField>
          <FormField label="Consequence of missing it" htmlFor="appt-consequence"><Select id="appt-consequence" value={f.consequence} disabled={cancelled} onChange={(e) => set('consequence', e.target.value as ConsequenceOfDelay)}>{CONSEQUENCE.map((x) => <option key={x}>{x}</option>)}</Select></FormField>
          <FormField label="Notes" htmlFor="appt-notes" className="sm:col-span-2"><Textarea id="appt-notes" rows={2} value={f.description} disabled={cancelled} onChange={(e) => set('description', e.target.value)} maxLength={1000} /></FormField>
        </form>
        {editing && (
          <section className="mt-5" aria-label="Appointment history">
            <h3 className="mb-2 text-sm font-medium">History</h3>
            {history.isPending ? <Skeleton className="h-10" /> : history.isError ? <p className="text-xs text-terracotta-ink">Could not load history.</p> : (
              <ul className="space-y-1 text-xs text-muted">{history.data.map((h) => <li key={h.id}><span className="font-medium capitalize text-ink">{h.action}</span>{h.action === 'rescheduled' && h.previousStartAt && h.newStartAt ? ` · ${h.previousStartAt.slice(0, 10)} ${fmtTime(h.previousStartAt)} → ${h.newStartAt.slice(0, 10)} ${fmtTime(h.newStartAt)}` : ''}{h.note ? ` · ${h.note}` : ''} · {h.createdAt.slice(0, 16).replace('T', ' ')} UTC</li>)}</ul>)}
          </section>)}
      </Modal>
      <ConfirmDialog open={confirmCancel} title="Cancel this appointment?" message="Its time will be released for planning. The record and its history are kept." confirmLabel="Cancel appointment" loading={cancel.isPending} onCancel={() => setConfirmCancel(false)}
        onConfirm={async () => { try { const r = await cancel.mutateAsync({ id: editing!.id }); setConfirmCancel(false); toast.success(`Appointment cancelled.${impactNote(r.impact)}`); onClose(); } catch (e) { setConfirmCancel(false); fail(e); } }} />
    </>
  );
}
