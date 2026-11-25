import { useEffect, useState } from 'react';
import { ApiError, messageOf } from '../../lib/api';
import { useAcceptBreak, useAddBreak, useMoveBlock, usePostpone, usePostponements, useRemoveBlock, useScheduleDiff, useSkipBlock } from '../../api/hooks';
import { Alert, Badge, Button, FormField, Input, Modal, Skeleton, useToast } from '../ui';
import type { CalendarAppointment, CalendarBlock, CalendarData, ScheduleProblem, ScheduleView, Task } from '../../lib/types';
import { fmtDay, fmtDuration, fmtRange, fmtTime, minutesBetween, shiftWall } from '../../lib/planner';

const errText = (e: unknown) => (e instanceof ApiError && e.errors?.length ? `${e.message} ${e.errors.map((x) => x.message).join('; ')}` : messageOf(e));

/** Details of one session or break. Drafts can be moved (with a validated preview), removed; the approved plan can only skip sessions. */
export function BlockDialog({ block, mode, draft, onClose }: { block: CalendarBlock | null; mode: 'draft' | 'active'; draft: ScheduleView | null | undefined; onClose: () => void }) {
  const toast = useToast(); const move = useMoveBlock(); const remove = useRemoveBlock(); const skip = useSkipBlock(); const accept = useAcceptBreak();
  const [start, setStart] = useState(''); const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  useEffect(() => { setStart(block?.start ?? ''); setMsg(null); }, [block?.id]);
  if (!block) return null;
  const isBreak = block.kind === 'break'; const editable = mode === 'draft' && !!draft && block.scheduleVersionId === draft.schedule.id; const revision = draft?.schedule.revision ?? 0;
  const end = start ? shiftWall(start, minutesBetween(block.start, block.end)) : '';
  const full = draft?.blocks.find((b) => b.id === block.id);
  const run = async (fn: () => Promise<unknown>, ok: string, close = true) => { setMsg(null); try { await fn(); toast.success(ok); if (close) onClose(); } catch (e) { setMsg({ tone: 'error', text: errText(e) }); } };
  return (
    <Modal open onClose={onClose} title={isBreak ? 'Break' : block.taskName}
      footer={<>
        {editable && <Button variant="danger" loading={remove.isPending} className="mr-auto" onClick={() => run(() => remove.mutateAsync({ id: block.scheduleVersionId, blockId: block.id, revision }), isBreak ? 'Break removed' : 'Session removed from the draft')}>{isBreak ? 'Remove break' : 'Remove session'}</Button>}
        {mode === 'active' && !isBreak && block.status === 'planned' && <Button variant="secondary" loading={skip.isPending} className="mr-auto" onClick={() => run(() => skip.mutateAsync({ id: block.scheduleVersionId, blockId: block.id }), 'Session marked as skipped')}>Skip this session</Button>}
        {editable && isBreak && block.status === 'suggested' && <Button variant="secondary" loading={accept.isPending} onClick={() => run(() => accept.mutateAsync({ id: block.scheduleVersionId, blockId: block.id, revision }), 'Break accepted')}>Accept break</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">When</dt><dd>{fmtDay(block.start.slice(0, 10))}, {fmtRange(block.start, block.end)} ({fmtDuration(block.durationMinutes)})</dd>
        <dt className="text-muted">Status</dt><dd className="capitalize">{block.status}{block.sessionCount > 1 && !isBreak ? ` · session ${block.sessionIndex} of ${block.sessionCount}` : ''}</dd>
        <dt className="text-muted">Source</dt><dd>{block.source === 'user' ? 'Moved by you' : block.source === 'kept' ? 'Kept from the approved schedule' : 'Planned automatically'}</dd>
        {(full?.reason ?? block.reason) && <><dt className="text-muted">Why here</dt><dd>{full?.reason ?? block.reason}</dd></>}
      </dl>
      {(full?.warnings ?? block.warnings ?? []).map((w) => <Alert key={w} tone="warning" className="mt-3">{w}</Alert>)}
      {msg && <Alert tone={msg.tone} className="mt-3">{msg.text}</Alert>}
      {editable ? (
        <form className="mt-4 space-y-2" aria-label="Move session" onSubmit={(e) => { e.preventDefault(); void run(() => move.mutateAsync({ id: block.scheduleVersionId, blockId: block.id, start, revision }), 'Moved'); }}>
          <FormField label="Move to" htmlFor="move-start" hint={end ? `Ends ${fmtTime(end)}. The server checks working hours, appointments, buffers and dependencies.` : undefined}><Input id="move-start" type="datetime-local" step={300} hasHint value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" loading={move.isPending} disabled={!start || start === block.start}
              onClick={async () => { setMsg(null); try { await move.mutateAsync({ id: block.scheduleVersionId, blockId: block.id, start, revision, preview: true }); setMsg({ tone: 'success', text: 'This position is valid.' }); } catch (e) { setMsg({ tone: 'error', text: errText(e) }); } }}>Check position</Button>
            <Button type="submit" size="sm" loading={move.isPending} disabled={!start || start === block.start}>Move</Button>
          </div>
        </form>
      ) : mode === 'draft' ? <p className="mt-4 text-xs text-muted">This draft changed since you opened it. Reload the planner.</p> : <p className="mt-4 text-xs text-muted">The active schedule is read-only. To change it, edit a copy as a draft, then approve.</p>}
    </Modal>
  );
}

export function AddBreakDialog({ open, draft, defaultDate, onClose }: { open: boolean; draft: ScheduleView | null | undefined; defaultDate: string; onClose: () => void }) {
  const toast = useToast(); const add = useAddBreak(); const [start, setStart] = useState(''); const [minutes, setMinutes] = useState('10'); const [msg, setMsg] = useState<string | null>(null); const [needsReplan, setNeedsReplan] = useState(false);
  useEffect(() => { if (open) { setStart(`${defaultDate}T12:00`); setMinutes('10'); setMsg(null); setNeedsReplan(false); } }, [open, defaultDate]);
  if (!open || !draft) return null;
  const n = Number(minutes); const valid = !!start && Number.isInteger(n) && n >= 5 && n <= 120;
  const submit = async (replan: boolean) => {
    setMsg(null);
    try { const r = await add.mutateAsync({ id: draft.schedule.id, start, end: shiftWall(start, n), revision: draft.schedule.revision, ...(replan ? { replan: true } : {}) }); toast.success(r.replanned?.length ? `Break added; ${r.replanned.length} session(s) re-planned` : 'Break added'); onClose(); }
    catch (e) { if (e instanceof ApiError && e.code === 'break_conflict') setNeedsReplan(true); setMsg(errText(e)); }
  };
  return (
    <Modal open onClose={onClose} title="Add a break" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>{needsReplan ? <Button loading={add.isPending} onClick={() => submit(true)}>Add and re-plan the displaced session</Button> : <Button loading={add.isPending} disabled={!valid} onClick={() => submit(false)}>Add break</Button>}</>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Starts" htmlFor="break-start"><Input id="break-start" type="datetime-local" step={300} value={start} onChange={(e) => { setStart(e.target.value); setNeedsReplan(false); setMsg(null); }} /></FormField>
        <FormField label="Length (minutes)" htmlFor="break-length" error={minutes && !valid && start ? 'Enter 5 to 120 minutes' : undefined}><Input id="break-length" type="number" min={5} max={120} step={5} value={minutes} onChange={(e) => { setMinutes(e.target.value); setNeedsReplan(false); }} /></FormField>
      </div>
      {msg && <Alert tone={needsReplan ? 'warning' : 'error'} className="mt-3">{msg}</Alert>}
    </Modal>
  );
}

/** Tooltip-equivalent for touch: tap a day in the month view. */
export function DayDialog({ date, data, show, onClose, onOpenDay, onNewAppointment }: { date: string | null; data: CalendarData; show: 'draft' | 'active'; onClose: () => void; onOpenDay: (d: string) => void; onNewAppointment: (d: string) => void }) {
  if (!date) return null;
  const info = data.days.find((d) => d.date === date); const blocks = (show === 'draft' ? data.draftBlocks : data.approvedBlocks).filter((b) => b.start.slice(0, 10) === date && b.status !== 'skipped');
  const appts = data.appointments.filter((a) => a.status === 'scheduled' && a.startAt.slice(0, 10) === date); const due = data.deadlines.filter((x) => x.dueDate === date); const done = data.completions.filter((c) => c.completedOn === date);
  const empty = !blocks.length && !appts.length && !due.length && !done.length;
  return (
    <Modal open onClose={onClose} title={fmtDay(date)} footer={<><Button variant="secondary" onClick={() => onNewAppointment(date)}>Add appointment</Button><Button onClick={() => onOpenDay(date)}>Open day</Button></>}>
      {info && <p className="mb-3 text-sm text-muted">{info.working ? `${info.working.start}–${info.working.end} · ${fmtDuration(info.freeMinutes)} free · planned ${fmtDuration(info.plannedMinutes)} · worked ${fmtDuration(info.actualMinutes)}` : 'Day off (outside your working days).'}</p>}
      {empty && <p className="text-sm text-muted">Nothing planned for this day.</p>}
      <ul className="space-y-1.5 text-sm">
        {appts.map((a: CalendarAppointment) => <li key={a.id}><Badge tone="dusty">Appointment</Badge> {fmtTime(a.startAt)} · {a.title}</li>)}
        {blocks.map((b) => <li key={b.id}><Badge tone={b.kind === 'break' ? 'olive' : 'neutral'}>{b.kind === 'break' ? 'Break' : 'Planned'}</Badge> {fmtTime(b.start)} · {b.kind === 'break' ? 'Break' : b.taskName}</li>)}
        {due.map((x) => <li key={x.taskId}><Badge tone="terracotta">Due</Badge> {x.taskName} <span className="text-muted">({x.status})</span></li>)}
        {done.map((x) => <li key={x.taskId}><Badge tone="olive">Completed</Badge> {x.taskName}</li>)}
      </ul>
    </Modal>
  );
}

export function DiffDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const diff = useScheduleDiff(id);
  if (!id) return null;
  const row = (b: { id: string; taskName: string; start: string; end: string; kind: string }) => <li key={b.id}>{fmtDay(b.start.slice(0, 10))} {fmtRange(b.start, b.end)} · {b.kind === 'break' ? 'Break' : b.taskName}</li>;
  return (
    <Modal open onClose={onClose} title="Changes compared with your active schedule" wide footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {diff.isPending ? <Skeleton className="h-24" /> : diff.isError ? <Alert tone="error">{messageOf(diff.error)}</Alert> : (
        <div className="grid gap-4 sm:grid-cols-2">
          <section><h3 className="mb-1 text-sm font-medium">Removed ({diff.data.removed.length})</h3>{diff.data.removed.length ? <ul className="space-y-1 text-xs">{diff.data.removed.map(row)}</ul> : <p className="text-xs text-muted">Nothing removed.</p>}</section>
          <section><h3 className="mb-1 text-sm font-medium">Added ({diff.data.added.length})</h3>{diff.data.added.length ? <ul className="space-y-1 text-xs">{diff.data.added.map(row)}</ul> : <p className="text-xs text-muted">Nothing added.</p>}</section>
          <p className="text-xs text-muted sm:col-span-2">{diff.data.unchanged} upcoming block(s) stay exactly where they are. Past blocks are not compared.</p>
        </div>)}
    </Modal>
  );
}

export function ProblemsList({ problems }: { problems: ScheduleProblem[] }) {
  if (!problems.length) return <p className="text-sm text-muted">No conflicts found.</p>;
  return <ul className="space-y-1.5 text-sm">{problems.map((p, i) => <li key={`${p.code}-${i}`} className="flex gap-2"><Badge tone={p.severity === 'error' ? 'terracotta' : 'amber'}>{p.severity === 'error' ? 'Conflict' : 'Notice'}</Badge><span>{p.message}</span></li>)}</ul>;
}

/** Postpone a task by N days. The deadline never changes; going past it needs an explicit confirmation. */
export function PostponeDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const toast = useToast(); const post = usePostpone(); const hist = usePostponements(task?.id ?? null); const [days, setDays] = useState('1'); const [reason, setReason] = useState(''); const [needConfirm, setNeedConfirm] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setDays('1'); setReason(''); setNeedConfirm(null); setErr(null); }, [task?.id]);
  if (!task) return null;
  const n = Number(days); const valid = Number.isInteger(n) && n >= 1 && n <= 30;
  const submit = async (confirm: boolean) => {
    setErr(null);
    try { const r = await post.mutateAsync({ id: task.id, days: n, reason: reason.trim() || undefined, ...(confirm ? { confirm: true } : {}) }); toast.success(`Postponed until ${r.task.postponedUntil}${r.pastDeadline ? ' (after the deadline)' : ''}. Regenerate your schedule to apply it.`); onClose(); }
    catch (e) { if (e instanceof ApiError && e.code === 'confirmation_required') setNeedConfirm(e.message); else setErr(messageOf(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`Postpone “${task.taskName}”`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>{needConfirm ? <Button variant="danger" loading={post.isPending} onClick={() => submit(true)}>Postpone anyway</Button> : <Button loading={post.isPending} disabled={!valid} onClick={() => submit(false)}>Postpone</Button>}</>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Postpone by (days)" htmlFor="postpone-days" error={!valid ? 'Enter 1 to 30 days' : undefined}><Input id="postpone-days" type="number" min={1} max={30} value={days} onChange={(e) => { setDays(e.target.value); setNeedConfirm(null); }} /></FormField>
        <FormField label="Reason (optional)" htmlFor="postpone-reason"><Input id="postpone-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </div>
      <p className="mt-2 text-xs text-muted">The task will not be scheduled before the new date. Its deadline{task.dueDate ? ` (${task.dueDate})` : ''} stays the same.{task.postponedUntil ? ` Currently postponed until ${task.postponedUntil}.` : ''}</p>
      {needConfirm && <Alert tone="warning" className="mt-3">{needConfirm}</Alert>}{err && <Alert tone="error" className="mt-3">{err}</Alert>}
      <section className="mt-4" aria-label="Postponement history"><h3 className="mb-1 text-sm font-medium">History{hist.data ? ` (${hist.data.postponeCount})` : ''}</h3>
        {hist.isPending ? <Skeleton className="h-8" /> : hist.isError ? <p className="text-xs text-terracotta-ink">Could not load history.</p> : hist.data.history.length === 0 ? <p className="text-xs text-muted">Never postponed.</p> : <ul className="space-y-1 text-xs text-muted">{hist.data.history.map((h) => <li key={h.id}>{h.previousPostponedUntil ?? 'today'} → <span className="text-ink">{h.newPostponedUntil}</span>{h.reason ? ` · ${h.reason}` : ''}</li>)}</ul>}</section>
    </Modal>
  );
}
