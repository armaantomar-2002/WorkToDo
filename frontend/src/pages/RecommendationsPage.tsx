import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, History, Sparkles, Timer, X, Zap } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Accordion, Alert, Badge, Button, Card, CardHeader, CategoryBadge, EmptyState, FormField, Pagination, Select, Skeleton, Spinner, useToast } from '../components/ui';
import { ScheduleTimeline } from '../components/planner/ScheduleTimeline';
import { FeedbackBar } from '../components/recommendations/FeedbackBar';
import { useApproveDraft, useGenerateDraft, useHistory, useOpenSchedule, usePreferences, useRejectDraft, useRunDetail, useSessions } from '../api/hooks';
import { ApiError, messageOf } from '../lib/api';
import { dueLabel, formatDate, formatDateTime, formatInstant, formatMinutes } from '../lib/format';
import { dateKeyInZone, safeZone } from '../lib/clock';
import { LEVEL, type Level, type RankedItem, type RunDetail } from '../lib/types';

const FACTORS: [keyof RankedItem, string][] = [['urgency', 'Urgency'], ['importance', 'Importance'], ['goalContribution', 'Goal contribution'], ['feasibility', 'Feasibility'], ['consequenceOfDelay', 'Consequence of delay'], ['timingSuitability', 'Timing suitability'], ['energySuitability', 'Energy suitability']];

function RankedCard({ item, today, runId }: { item: RankedItem; today: string; runId: string }) {
  return (
    <li className="card p-5" data-testid="ranked-item">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-md bg-olive-soft px-2 py-0.5 text-xs font-bold text-olive-ink" aria-label={`Rank ${item.rank}`}>#{item.rank}</span>
        <h3 className="font-serif text-lg font-semibold">{item.taskName}</h3>
        <CategoryBadge value={item.category} />
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
        <span>{item.dueDate ? `${dueLabel(item.dueDate, today)} (${formatDate(item.dueDate)})` : 'No deadline'}</span>
        <span>{formatMinutes(item.estimatedDurationMinutes)}</span>
        <span className={item.startableNow ? 'font-semibold text-olive-ink' : ''}>{item.startableNow ? 'Startable now' : 'Cannot start in this slot'}</span>
        {item.taskDeleted && <span className="font-semibold text-terracotta">Task since deleted</span>}
      </p>
      <p className="mt-3 text-sm">{item.reason}</p>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none font-medium text-terracotta">Why the model ranked it here (factor breakdown)</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {FACTORS.map(([key, label]) => (
            <div key={key}><div className="flex justify-between text-xs"><dt className="text-muted">{label}</dt><dd className="font-semibold">{(item[key] as number).toFixed(1)}</dd></div>
              <div className="mt-1 h-1.5 rounded-full bg-line" role="presentation"><div className="h-full rounded-full bg-olive" style={{ width: `${Math.max(0, Math.min(100, item[key] as number))}%` }} /></div></div>
          ))}
        </dl>
      </details>
      {item.taskId && !item.taskDeleted && <Link to={`/sessions?task=${item.taskId}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-terracotta hover:underline"><Timer className="h-3.5 w-3.5" aria-hidden="true" />Start a focus timer</Link>}
      <FeedbackBar key={`${runId}-${item.itemId}`} runId={runId} itemId={item.itemId} taskName={item.taskName} initial={item.feedback} />
    </li>
  );
}

function Results({ detail, past, onBack }: { detail: RunDetail; past: boolean; onBack: () => void }) {
  const { run, ranked, excluded } = detail; const today = run.session.localTime.slice(0, 10);
  return (
    <div className="space-y-4">
      {past && <Alert tone="info"><div className="flex flex-wrap items-center justify-between gap-2"><span>Viewing a past run from {formatInstant(run.createdAt)}. Task details are the saved snapshot from that time.</span><Button size="sm" variant="secondary" onClick={onBack}>Back to new run</Button></div></Alert>}
      <Card>
        <CardHeader title={`Recommendations (${ranked.length})`} action={<span className="text-xs text-muted">{run.summary.eligible} eligible · {run.summary.excluded} excluded · {run.summary.startableNow} startable now</span>} />
        <div className="px-5 pb-5 pt-3">
          <p className="mb-3 text-xs text-muted">Session: {formatDateTime(run.session.localTime)} · {run.session.availableTimeMinutes} min available · longest slot {run.session.longestFreeSlotMinutes} min · {run.session.energyLevel} energy · {run.session.focusLevel} focus · {run.session.currentTimePeriod}</p>
          {ranked.length === 0 ? <EmptyState icon={Sparkles} title="Nothing to recommend" message="None of your tasks is eligible right now. Check the excluded tasks below for the reasons." />
            : <ol className="space-y-3">{ranked.map((r) => <RankedCard key={r.rank} item={r} today={today} runId={run.id} />)}</ol>}
        </div>
      </Card>
      <Accordion title={`Excluded Tasks (${excluded.length})`}>
        {excluded.length === 0 ? <p className="text-sm text-muted">No tasks were excluded.</p> : (
          <ul className="divide-y divide-line">{excluded.map((e, i) => <li key={`${e.taskId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><span className="font-medium">{e.taskName}</span><span className="text-muted">{e.exclusionReason}</span></li>)}</ul>)}
      </Accordion>
    </div>
  );
}

export default function RecommendationsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const prefs = usePreferences();
  const sessions = useSessions(1, 50);
  const generate = useGenerateDraft(); const approve = useApproveDraft(); const reject = useRejectDraft();
  const draft = useOpenSchedule('draft'); const active = useOpenSchedule('active');
  const [savedId, setSavedId] = useState(params.get('session') ?? '');
  const [form, setForm] = useState<{ energy: Level | ''; focus: Level | '' }>({ energy: '', focus: '' });
  const [showHistory, setShowHistory] = useState(false);
  const [histPage, setHistPage] = useState(1);
  const [viewId, setViewId] = useState<string | null>(null);
  const history = useHistory(histPage, showHistory);
  const past = useRunDetail(viewId);
  const saved = sessions.data?.items.find((s) => s.id === savedId);

  useEffect(() => { if (savedId && sessions.data && !saved) setSavedId(''); }, [savedId, sessions.data, saved]);
  // "How you feel now": the saved session (if chosen) or the form, falling back to the user's defaults. Availability always comes from the calendar.
  const energy: Level = saved?.energyLevel ?? (form.energy || prefs.data?.defaultEnergyLevel) ?? 'Medium';
  const focus: Level = saved?.focusLevel ?? (form.focus || prefs.data?.defaultFocusLevel) ?? 'Medium';
  const pickSaved = (id: string) => { setSavedId(id); setParams(id ? { session: id } : {}); };

  // ONE schedule: the open draft if there is one, otherwise the active schedule. The Planner reads the very same draft.
  const view = draft.data ?? active.data ?? null; const isDraft = !!draft.data;
  const runDetail = useRunDetail(view?.schedule.recommendationRunId ?? null);
  const zoneToday = dateKeyInZone(new Date(), safeZone(prefs.data?.timeZone));
  const submit = async () => {
    setViewId(null);
    try {
      const r = await generate.mutateAsync({ mode: active.data ? 'minimal' : 'fresh', replace: true, energyLevel: energy, focusLevel: focus });
      toast.success(r.unscheduled.length || r.infeasibilities.length ? 'Schedule draft ready — some tasks need attention. Review it below.' : 'Schedule draft ready. Review it, then approve it in the Planner or here.');
    } catch (e) { toast.error(messageOf(e)); }
  };
  const decide = async (kind: 'approve' | 'reject') => {
    if (!draft.data) return;
    try {
      if (kind === 'approve') { await approve.mutateAsync({ id: draft.data.schedule.id, revision: draft.data.schedule.revision }); toast.success('Schedule approved and now active'); }
      else { await reject.mutateAsync({ id: draft.data.schedule.id }); toast.success('Draft rejected'); }
    } catch (e) { toast.error(messageOf(e)); }
  };

  const shownPast: RunDetail | undefined = viewId ? past.data : undefined;
  const err = generate.error;
  const hasErrors = !!draft.data?.problems.some((p) => p.severity === 'error');

  return (
    <>
      <PageHeader title="Task Recommendations" subtitle="Get a time-ordered plan: fixed appointments stay put and your tasks are arranged around them." actions={<Button variant="secondary" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}><History className="h-4 w-4" aria-hidden="true" />History</Button>} />
      {showHistory && (
        <Card className="mb-6" aria-label="Recommendation history">
          <CardHeader title="Recommendation History" action={<button type="button" onClick={() => setShowHistory(false)} aria-label="Close history" className="rounded p-1 text-muted hover:text-ink"><X className="h-5 w-5" /></button>} />
          {history.isPending ? <Spinner /> : history.isError ? <p className="p-5 text-sm text-terracotta">{messageOf(history.error)}</p>
            : history.data.items.length === 0 ? <EmptyState icon={History} title="No runs yet" message="Your successful recommendation runs will appear here." />
            : (<><ul className="divide-y divide-line px-5 pt-2">{history.data.items.map((h) => (
                <li key={h.id}><button type="button" onClick={() => { setViewId(h.id); setShowHistory(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-sm hover:bg-surface-2/60">
                  <span><span className="font-semibold">{formatInstant(h.createdAt)}</span><span className="block text-xs text-muted">{h.session.availableTimeMinutes} min · {h.session.energyLevel} energy · {h.session.focusLevel} focus · {h.summary.returned} ranked / {h.summary.excluded} excluded</span></span>
                  <span className="text-xs text-muted">{h.topRecommendation ? <>Top: <span className="font-semibold text-ink">{h.topRecommendation.taskName}</span></> : 'No eligible tasks'}</span></button></li>))}</ul>
              <Pagination page={history.data.page} totalPages={history.data.totalPages} total={history.data.total} onPage={setHistPage} noun="runs" /></>)}
        </Card>)}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="self-start">
          <CardHeader title="How you feel now" />
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-4 px-5 pb-5 pt-4" aria-label="Session context">
            <FormField label="Use a saved session" htmlFor="savedSession">
              <Select id="savedSession" value={savedId} onChange={(e) => pickSaved(e.target.value)}>
                <option value="">Use my current energy and focus</option>
                {sessions.data?.items.map((s) => <option key={s.id} value={s.id}>{formatDateTime(s.sessionDateTime)} · {s.energyLevel} energy · {s.focusLevel} focus</option>)}
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Energy Level" htmlFor="energy"><Select id="energy" value={energy} disabled={!!saved} onChange={(e) => setForm((f) => ({ ...f, energy: e.target.value as Level }))}>{LEVEL.map((p) => <option key={p}>{p}</option>)}</Select></FormField>
              <FormField label="Focus Level" htmlFor="focus"><Select id="focus" value={focus} disabled={!!saved} onChange={(e) => setForm((f) => ({ ...f, focus: e.target.value as Level }))}>{LEVEL.map((p) => <option key={p}>{p}</option>)}</Select></FormField>
            </div>
            <Button type="submit" block loading={generate.isPending}><Sparkles className="h-4 w-4" aria-hidden="true" />Get Recommendations</Button>
            <p className="flex items-start gap-1.5 text-xs text-muted"><Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>Free time comes from your calendar, appointments and working hours. Your tasks are ranked by the trained model, then arranged around fixed commitments.</span></p>
          </form>
        </Card>

        <div className="min-w-0 space-y-4" aria-live="polite">
          {err && <Alert tone="error">{messageOf(err)}</Alert>}
          {viewId && past.isPending && <Skeleton className="h-64" />}
          {viewId && past.isError && <Alert tone="error">{messageOf(past.error)}</Alert>}
          {shownPast && <Results detail={shownPast} past onBack={() => setViewId(null)} />}
          {generate.isPending && !viewId && <Card><Spinner label="Building your schedule" /></Card>}
          {!viewId && !generate.isPending && view && (
            <>
              <Card>
                <CardHeader title={isDraft ? `Schedule draft v${view.schedule.versionNumber}` : `Active schedule v${view.schedule.versionNumber}`}
                  action={<span className="flex items-center gap-2"><Badge tone={isDraft ? 'amber' : 'olive'}>{isDraft ? 'Draft — not active yet' : 'Active'}</Badge><Link to={`/planner?date=${zoneToday}`} className="text-xs font-semibold text-terracotta hover:underline">Open in Planner</Link></span>} />
                <div className="space-y-4 px-5 pb-5 pt-3">
                  {isDraft && view.stale?.isStale && <Alert tone="warning">Your {view.stale.changed.join(', ')} changed after this draft was made. Press “Get Recommendations” to refresh it before approving.</Alert>}
                  {view.notes.ml && <Alert tone="info">{view.notes.ml}</Alert>}
                  <ScheduleTimeline view={view} />
                  {isDraft && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                      <Button onClick={() => void decide('approve')} loading={approve.isPending} disabled={!!view.stale?.isStale || hasErrors}>Approve schedule</Button>
                      <Button variant="secondary" onClick={() => void decide('reject')} loading={reject.isPending}>Reject draft</Button>
                      <span className="text-xs text-muted">The Planner shows this same draft. Nothing changes until you approve it.</span>
                    </div>)}
                </div>
              </Card>
              {runDetail.data && <Accordion title="Model ranking details & feedback"><Results detail={runDetail.data} past={false} onBack={() => {}} /></Accordion>}
            </>)}
          {!viewId && !generate.isPending && !view && !err && (
            <Card><EmptyState icon={CheckCircle2} title="Ready when you are" message="Press “Get Recommendations” to get one schedule with exact start and end times. It is saved as a draft you can review here or in the Planner." /></Card>)}
        </div>
      </div>
    </>
  );
}
