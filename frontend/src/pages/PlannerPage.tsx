import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, Coffee, RefreshCw, Sparkles } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, PillTabs, Skeleton, useToast } from '../components/ui';
import { MonthGrid, TimeGrid } from '../components/planner/CalendarViews';
import { ScheduleTimeline } from '../components/planner/ScheduleTimeline';
import { AppointmentModal, type ApptTarget } from '../components/planner/AppointmentModal';
import { AddBreakDialog, BlockDialog, DayDialog, DiffDialog, ProblemsList } from '../components/planner/PlannerDialogs';
import { useApproveDraft, useCalendar, useGenerateDraft, useMoveBlock, useOpenSchedule, usePreferences, useRejectDraft, useScheduleList } from '../api/hooks';
import { ApiError, messageOf } from '../lib/api';
import { DEFAULT_TIME_ZONE, dateKeyInZone, safeZone } from '../lib/clock';
import { fmtDay, fmtDuration, isDateKey, rangeFor, step, viewTitle, type View } from '../lib/planner';
import type { CalendarAppointment, CalendarBlock } from '../lib/types';

const VIEWS: { value: View; label: string }[] = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }];
const errText = (e: unknown) => (e instanceof ApiError && e.errors?.length ? `${e.message} ${e.errors.map((x) => x.message).join('; ')}` : messageOf(e));

export default function PlannerPage() {
  const toast = useToast(); const prefs = usePreferences(); const [params, setParams] = useSearchParams();
  const todayLocal = dateKeyInZone(new Date(), safeZone(prefs.data?.timeZone ?? DEFAULT_TIME_ZONE));
  const viewParam = params.get('view'); const view: View = viewParam === 'day' || viewParam === 'month' ? viewParam : 'week';
  const dateParam = params.get('date'); const anchor = dateParam && isDateKey(dateParam) ? dateParam : todayLocal;
  const go = (v: View, d: string) => setParams({ view: v, date: d }, { replace: true });
  const { from, to } = rangeFor(view, anchor);
  const cal = useCalendar(from, to); const draft = useOpenSchedule('draft'); const active = useOpenSchedule('active'); const history = useScheduleList();
  const generate = useGenerateDraft(); const approve = useApproveDraft(); const reject = useRejectDraft(); const move = useMoveBlock();
  const [showPref, setShowPref] = useState<'draft' | 'active' | null>(null);
  const hasDraft = !!draft.data; const show: 'draft' | 'active' = showPref ?? (hasDraft ? 'draft' : 'active');
  useEffect(() => { if (showPref === 'draft' && !hasDraft) setShowPref(null); }, [hasDraft, showPref]);
  const [appt, setAppt] = useState<ApptTarget | null>(null); const [block, setBlock] = useState<{ b: CalendarBlock; mode: 'draft' | 'active' } | null>(null);
  const [dayInfo, setDayInfo] = useState<string | null>(null); const [addBreak, setAddBreak] = useState(false); const [diffId, setDiffId] = useState<string | null>(null); const [confirmReject, setConfirmReject] = useState(false); const [moveError, setMoveError] = useState<string | null>(null);
  const [replaceAsk, setReplaceAsk] = useState<null | { mode: 'minimal' | 'fresh' | 'clone' }>(null);

  const d = draft.data; const a = active.data; const canEditDraft = show === 'draft' && !!d;
  const unscheduled = (show === 'draft' ? d?.unscheduled : a?.unscheduled) ?? []; const problems = (show === 'draft' ? d?.problems : a?.problems) ?? [];
  const startGenerate = async (mode: 'minimal' | 'fresh' | 'clone', replace = false) => {
    try { const r = await generate.mutateAsync({ mode, replace }); setShowPref('draft'); setReplaceAsk(null); toast.success(r.unscheduled.length ? `Draft ready — ${r.unscheduled.length} task(s) could not be placed. Review before approving.` : 'Draft ready — review it, then approve.'); }
    catch (e) { if (e instanceof ApiError && e.code === 'draft_exists') setReplaceAsk({ mode }); else toast.error(errText(e)); }
  };
  const onMove = async (b: CalendarBlock, newStart: string) => {
    if (!d || b.scheduleVersionId !== d.schedule.id) return; setMoveError(null);
    if (newStart === b.start) return;
    try { await move.mutateAsync({ id: d.schedule.id, blockId: b.id, start: newStart, revision: d.schedule.revision }); toast.success('Moved'); }
    catch (e) { const t = errText(e); setMoveError(t); toast.error(t); }
  };
  const approveDraft = async () => { if (!d) return; try { await approve.mutateAsync({ id: d.schedule.id, revision: d.schedule.revision }); setShowPref('active'); toast.success('Schedule approved and now active'); } catch (e) { toast.error(errText(e)); } };
  const hasWork = (cal.data?.draftBlocks.length ?? 0) + (cal.data?.approvedBlocks.length ?? 0) + (cal.data?.appointments.length ?? 0) > 0;
  const defaultStart = anchor === todayLocal && cal.data ? `${cal.data.now.slice(0, 13)}:00` : `${anchor}T09:00`;
  const title = useMemo(() => viewTitle(view, anchor), [view, anchor]);

  return (
    <div>
      <PageHeader title="Planner" subtitle="Appointments are fixed. Your tasks are arranged around them — nothing changes until you approve it."
        actions={<><Button variant="secondary" onClick={() => setAppt({ mode: 'create', startAt: defaultStart })}><CalendarPlus className="h-4 w-4" aria-hidden="true" /> Appointment</Button>
          <Button onClick={() => startGenerate(a ? 'minimal' : 'fresh')} loading={generate.isPending}><Sparkles className="h-4 w-4" aria-hidden="true" /> {a ? 'Re-plan' : 'Generate schedule'}</Button></>} />

      {d && (
        <Card className="mb-4 border-primary/40"><div className="flex flex-wrap items-center gap-3 px-4 py-3" role="region" aria-label="Draft schedule">
          <Badge tone="amber">Draft v{d.schedule.versionNumber}</Badge>
          <p className="min-w-0 flex-1 text-sm">{d.stale?.isStale ? <span className="text-terracotta-ink">Your {d.stale.changed.join(', ')} changed after this draft was made. Regenerate it before approving.</span> : 'This draft is not active yet. Review it, adjust if needed, then approve.'}{d.schedule.orderSource === 'fallback' && <span className="text-muted"> Ordered by deadline and importance (the recommendation service was not used).</span>}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDiffId(d.schedule.id)} disabled={!a}>What changes?</Button>
            <Button size="sm" variant="secondary" onClick={() => setAddBreak(true)}><Coffee className="h-4 w-4" aria-hidden="true" /> Add break</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmReject(true)}>Reject</Button>
            <Button size="sm" onClick={approveDraft} loading={approve.isPending} disabled={!!d.stale?.isStale || d.problems.some((p) => p.severity === 'error')}>Approve</Button>
          </div></div></Card>)}
      {!d && a?.needsRecalculation && <Alert tone="warning" className="mb-4">Your active schedule no longer fits your current appointments and tasks. It has not been changed. <button type="button" className="font-medium underline" onClick={() => startGenerate('minimal')}>Create an updated draft</button> to review the changes.</Alert>}
      {d?.notes.ml && <Alert tone="info" className="mb-4">{d.notes.ml}</Alert>}
      {moveError && <Alert tone="error" className="mb-4">{moveError}</Alert>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" aria-label="Previous" onClick={() => go(view, step(view, anchor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="secondary" onClick={() => go(view, todayLocal)}>Today</Button>
          <Button size="sm" variant="secondary" aria-label="Next" onClick={() => go(view, step(view, anchor, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <h2 className="mr-auto font-serif text-lg font-semibold" aria-live="polite">{title}</h2>
        {hasDraft && a && <PillTabs label="Which schedule to show" value={show} onChange={(v) => setShowPref(v)} items={[{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' }]} />}
        <PillTabs label="Calendar view" value={view} onChange={(v) => go(v, anchor)} items={VIEWS} />
      </div>

      {cal.isPending ? <Skeleton className="h-[480px]" /> : cal.isError ? <Card><ErrorState message={messageOf(cal.error)} onRetry={() => cal.refetch()} /></Card> : (
        <>
          {!hasWork && !a && !d && <Alert tone="info" className="mb-3">Nothing is planned yet. Add appointments, then choose <b>Generate schedule</b> to arrange your open tasks around them.</Alert>}
          {view === 'month' ? <MonthGrid data={cal.data} anchor={anchor} show={show} onOpenDay={setDayInfo} />
            : <TimeGrid data={cal.data} view={view} anchor={anchor} show={show} canEdit={canEditDraft} onMove={onMove} onBlock={(b, mode) => setBlock({ b, mode })} onAppointment={(x: CalendarAppointment) => setAppt({ mode: 'edit', appt: x })} onEmpty={(_day, start) => setAppt({ mode: 'create', startAt: start })} onOpenDay={setDayInfo} />}
          <p className="mt-2 text-xs text-muted">Times are in {cal.data.timeZone}. {canEditDraft ? 'Drag a session to move it, or select it and use “Move to” (works on touch and keyboard). Every move is checked by the server.' : 'Select a session for details.'} Click an empty slot to add an appointment.</p>
        </>)}

      {(show === 'draft' ? d : a) && (
        <Card className="mt-6"><CardHeader title={show === 'draft' ? `Schedule order — draft v${d!.schedule.versionNumber}` : `Schedule order — active v${a!.schedule.versionNumber}`} action={<span className="text-xs text-muted">The same list as the Recommendations page</span>} />
          <div className="px-5 pb-5 pt-3"><ScheduleTimeline view={(show === 'draft' ? d : a)!} showUnscheduled={false} /></div></Card>)}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title={`Needs attention${unscheduled.length ? ` (${unscheduled.length})` : ''}`} />
          <div className="space-y-2 px-5 pb-5 pt-3">
            {unscheduled.length === 0 ? <p className="text-sm text-muted">{(show === 'draft' ? d : a) ? 'Every open task has time in this schedule.' : 'Generate a schedule to see which tasks fit.'}</p> : (
              <ul className="space-y-2 text-sm">{unscheduled.map((u) => <li key={u.taskId}><span className="font-medium">{u.taskName}</span> <span className="text-muted">— {fmtDuration(u.remainingMinutes - u.scheduledMinutes)} unplaced</span><br /><span className="text-xs text-muted">{u.message}</span></li>)}</ul>)}
            <h3 className="pt-2 text-sm font-medium">Conflicts</h3><ProblemsList problems={problems} />
          </div></Card>
        <Card><CardHeader title="Schedule history" />
          <div className="px-5 pb-5 pt-3">{history.isPending ? <Skeleton className="h-16" /> : history.isError ? <ErrorState message={messageOf(history.error)} onRetry={() => history.refetch()} /> : history.data.length === 0 ? <EmptyState title="No schedules yet" message="Approved, rejected and replaced versions will appear here." /> : (
            <ul className="divide-y divide-line text-sm">{history.data.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 py-2"><Badge tone={h.status === 'approved' ? 'olive' : h.status === 'draft' ? 'amber' : 'neutral'}>{h.status}</Badge><span>v{h.versionNumber}</span><span className="text-muted">{h.horizonFrom
  ? fmtDay(h.horizonFrom.slice(0, 10))
  : '—'}
{' → '}
{h.horizonTo
  ? fmtDay(h.horizonTo.slice(0, 10))
  : '—'}</span>
                <span className="ml-auto text-xs text-muted">{h.orderSource === 'ml' ? 'ranked by ML' : 'rule-based order'}</span></li>))}</ul>)}
            {!d && a && <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => startGenerate('clone')} loading={generate.isPending}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Edit a copy of the active schedule</Button><Button size="sm" variant="secondary" onClick={() => startGenerate('fresh')}>Re-plan everything from scratch</Button></div>}
          </div></Card>
      </div>

      <AppointmentModal target={appt} onClose={() => setAppt(null)} />
      <BlockDialog block={block?.b ?? null} mode={block?.mode ?? 'active'} draft={d} onClose={() => setBlock(null)} />
      <AddBreakDialog open={addBreak} draft={d} defaultDate={anchor} onClose={() => setAddBreak(false)} />
      <DiffDialog id={diffId} onClose={() => setDiffId(null)} />
      {cal.data && <DayDialog date={dayInfo} data={cal.data} show={show} onClose={() => setDayInfo(null)} onOpenDay={(day) => { setDayInfo(null); go('day', day); }} onNewAppointment={(day) => { setDayInfo(null); setAppt({ mode: 'create', startAt: `${day}T09:00` }); }} />}
      <ConfirmDialog open={confirmReject} title="Reject this draft?" message="The draft is discarded. Your active schedule is not changed." confirmLabel="Reject draft" loading={reject.isPending} onCancel={() => setConfirmReject(false)}
        onConfirm={async () => { try { await reject.mutateAsync({ id: d!.schedule.id }); setConfirmReject(false); setShowPref('active'); toast.success('Draft rejected'); } catch (e) { setConfirmReject(false); toast.error(errText(e)); } }} />
      <ConfirmDialog open={!!replaceAsk} title="Replace your open draft?" message="You already have a draft waiting for review. Generating a new one rejects it. Your active schedule is not changed." confirmLabel="Replace draft" loading={generate.isPending} onCancel={() => setReplaceAsk(null)} onConfirm={() => startGenerate(replaceAsk!.mode, true)} />
    </div>
  );
}
