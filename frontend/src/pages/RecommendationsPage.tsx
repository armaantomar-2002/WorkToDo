import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, History, Hourglass, Sparkles, Timer, X, Zap } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Accordion, Alert, Button, Card, CardHeader, CategoryBadge, EmptyState, FormField, Input, Pagination, Select, Skeleton, Spinner } from '../components/ui';
import { FeedbackBar } from '../components/recommendations/FeedbackBar';
import { useHistory, useRunDetail, useRunRecommendation, useSessions } from '../api/hooks';
import { ApiError, messageOf } from '../lib/api';
import { dueLabel, formatDate, formatDateTime, formatInstant, formatMinutes, fromInputDateTime, nowLocal, periodForHour, todayLocal, toInputDateTime } from '../lib/format';
import { LEVEL, TIME_PERIOD, type Level, type RankedItem, type RunDetail, type RunInput, type TimePeriod } from '../lib/types';

const FACTORS: [keyof RankedItem, string][] = [['urgency', 'Urgency'], ['importance', 'Importance'], ['goalContribution', 'Goal contribution'], ['feasibility', 'Feasibility'], ['consequenceOfDelay', 'Consequence of delay'], ['timingSuitability', 'Timing suitability'], ['energySuitability', 'Energy suitability']];

function RankedCard({ item, today, runId }: { item: RankedItem; today: string; runId: string }) {
  return (
    <li className="card p-5" data-testid="ranked-item">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-md bg-olive-soft px-2 py-0.5 text-xs font-bold text-olive-ink" aria-label={`Rank ${item.rank}`}>#{item.rank}</span>
        <h3 className="font-serif text-lg font-semibold">{item.taskName}</h3>
        <CategoryBadge value={item.category} />
        <span className="ml-auto text-sm font-semibold">Score: {item.mlScore.toFixed(2)}</span>
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
        <span>{item.dueDate ? `${dueLabel(item.dueDate, today)} (${formatDate(item.dueDate)})` : 'No deadline'}</span>
        <span>{formatMinutes(item.estimatedDurationMinutes)}</span>
        <span className={item.startableNow ? 'font-semibold text-olive-ink' : ''}>{item.startableNow ? 'Startable now' : 'Cannot start in this slot'}</span>
        {item.taskDeleted && <span className="font-semibold text-terracotta">Task since deleted</span>}
      </p>
      <p className="mt-3 text-sm">{item.reason}</p>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none font-medium text-terracotta">Score breakdown</summary>
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
  const today = todayLocal();
  const { run, ranked, excluded } = detail;
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
  const [params, setParams] = useSearchParams();
  const sessions = useSessions(1, 50);
  const run = useRunRecommendation();
  const [savedId, setSavedId] = useState(params.get('session') ?? '');
  const [form, setForm] = useState({ when: toInputDateTime(nowLocal()), available: 120, longest: 120, period: periodForHour(new Date().getHours()) as TimePeriod, energy: 'Medium' as Level, focus: 'Medium' as Level });
  const [showHistory, setShowHistory] = useState(false);
  const [histPage, setHistPage] = useState(1);
  const [viewId, setViewId] = useState<string | null>(null);
  const history = useHistory(histPage, showHistory);
  const past = useRunDetail(viewId);
  const saved = sessions.data?.items.find((s) => s.id === savedId);

  useEffect(() => { if (savedId && sessions.data && !saved) setSavedId(''); }, [savedId, sessions.data, saved]);
  const effective = saved
    ? { when: toInputDateTime(saved.sessionDateTime), available: saved.availableTimeMinutes, longest: saved.longestFreeSlotMinutes, period: saved.currentTimePeriod, energy: saved.energyLevel, focus: saved.focusLevel }
    : form;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const pickSaved = (id: string) => { setSavedId(id); setParams(id ? { session: id } : {}); };

  const localError = (() => {
    if (saved) return null;
    if (!form.when) return 'Choose the session date and time.';
    if (!Number.isInteger(form.available) || form.available < 1) return 'Available time must be at least 1 minute.';
    if (!Number.isInteger(form.longest) || form.longest < 0) return 'Longest free slot must be 0 or more minutes.';
    if (form.longest > form.available) return 'The longest free slot cannot exceed the available time.';
    return null;
  })();
  const [submitted, setSubmitted] = useState(false);
  const submit = () => {
    setSubmitted(true);
    if (localError) return;
    setViewId(null);
    const body: RunInput = saved ? { focusSessionId: saved.id } : { localTime: fromInputDateTime(form.when), availableTimeMinutes: form.available, longestFreeSlotMinutes: form.longest, currentTimePeriod: form.period, energyLevel: form.energy, focusLevel: form.focus };
    run.mutate(body);
  };

  const shown: RunDetail | undefined = viewId ? past.data : run.data;
  const err = run.error;
  const errorText = err instanceof ApiError && err.code === 'no_active_tasks' ? <>You have no Pending or In Progress tasks. <Link to="/tasks" className="font-semibold underline">Add or reopen a task</Link> first.</> : err ? messageOf(err) : null;

  return (
    <>
      <PageHeader title="Task Recommendations" subtitle="Get intelligent suggestions on what to do next." actions={<Button variant="secondary" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}><History className="h-4 w-4" aria-hidden="true" />History</Button>} />
      {showHistory && (
        <Card className="mb-6" aria-label="Recommendation history">
          <CardHeader title="Recommendation History" action={<button type="button" onClick={() => setShowHistory(false)} aria-label="Close history" className="rounded p-1 text-muted hover:text-ink"><X className="h-5 w-5" /></button>} />
          {history.isPending ? <Spinner /> : history.isError ? <p className="p-5 text-sm text-terracotta">{messageOf(history.error)}</p>
            : history.data.items.length === 0 ? <EmptyState icon={History} title="No runs yet" message="Your successful recommendation runs will appear here." />
            : (<><ul className="divide-y divide-line px-5 pt-2">{history.data.items.map((h) => (
                <li key={h.id}><button type="button" onClick={() => { setViewId(h.id); setShowHistory(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-sm hover:bg-surface-2/60">
                  <span><span className="font-semibold">{formatInstant(h.createdAt)}</span><span className="block text-xs text-muted">{h.session.availableTimeMinutes} min · {h.session.energyLevel} energy · {h.session.focusLevel} focus · {h.summary.returned} ranked / {h.summary.excluded} excluded</span></span>
                  <span className="text-xs text-muted">{h.topRecommendation ? <>Top: <span className="font-semibold text-ink">{h.topRecommendation.taskName}</span> ({h.topRecommendation.mlScore.toFixed(1)})</> : 'No eligible tasks'}</span></button></li>))}</ul>
              <Pagination page={history.data.page} totalPages={history.data.totalPages} total={history.data.total} onPage={setHistPage} noun="runs" /></>)}
        </Card>)}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="self-start">
          <CardHeader title="Session Context" />
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate className="space-y-4 px-5 pb-5 pt-4" aria-label="Session context">
            <FormField label="Use a saved session" htmlFor="savedSession">
              <Select id="savedSession" value={savedId} onChange={(e) => pickSaved(e.target.value)}>
                <option value="">Enter context manually</option>
                {sessions.data?.items.map((s) => <option key={s.id} value={s.id}>{formatDateTime(s.sessionDateTime)} · {s.availableTimeMinutes} min</option>)}
              </Select>
            </FormField>
            <FormField label="Local Date & Time" htmlFor="when"><Input id="when" type="datetime-local" icon={CalendarClock} value={effective.when} disabled={!!saved} onChange={(e) => set('when', e.target.value)} /></FormField>
            <FormField label="Available Time (minutes)" htmlFor="available"><Input id="available" type="number" min={1} icon={Hourglass} value={Number.isNaN(effective.available) ? '' : effective.available} disabled={!!saved} onChange={(e) => set('available', e.target.valueAsNumber)} /></FormField>
            <FormField label="Longest Free Slot (minutes)" htmlFor="longest"><Input id="longest" type="number" min={0} icon={Timer} value={Number.isNaN(effective.longest) ? '' : effective.longest} disabled={!!saved} onChange={(e) => set('longest', e.target.valueAsNumber)} /></FormField>
            <FormField label="Time Period" htmlFor="period"><Select id="period" value={effective.period} disabled={!!saved} onChange={(e) => set('period', e.target.value as TimePeriod)}>{TIME_PERIOD.map((p) => <option key={p}>{p}</option>)}</Select></FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Energy Level" htmlFor="energy"><Select id="energy" value={effective.energy} disabled={!!saved} onChange={(e) => set('energy', e.target.value as Level)}>{LEVEL.map((p) => <option key={p}>{p}</option>)}</Select></FormField>
              <FormField label="Focus Level" htmlFor="focus"><Select id="focus" value={effective.focus} disabled={!!saved} onChange={(e) => set('focus', e.target.value as Level)}>{LEVEL.map((p) => <option key={p}>{p}</option>)}</Select></FormField>
            </div>
            {submitted && localError && <p role="alert" className="text-xs font-medium text-terracotta">{localError}</p>}
            <Button type="submit" block loading={run.isPending}><Sparkles className="h-4 w-4" aria-hidden="true" />Get Recommendations</Button>
            <p className="flex items-start gap-1.5 text-xs text-muted"><Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>Your own tasks are loaded securely on the server and ranked by the trained model.</span></p>
          </form>
        </Card>

        <div className="min-w-0 space-y-4" aria-live="polite">
          {errorText && !viewId && <Alert tone="error">{errorText}</Alert>}
          {viewId && past.isPending && <Skeleton className="h-64" />}
          {viewId && past.isError && <Alert tone="error">{messageOf(past.error)}</Alert>}
          {run.isPending && !viewId && <Card><Spinner label="Ranking your tasks" /></Card>}
          {shown && !(run.isPending && !viewId) && <Results detail={shown} past={!!viewId} onBack={() => setViewId(null)} />}
          {!shown && !run.isPending && !errorText && !(viewId && past.isPending) && (
            <Card><EmptyState icon={CheckCircle2} title="Ready when you are" message="Describe your current session on the left and press “Get Recommendations”. Every result is saved to your history." /></Card>)}
        </div>
      </div>
    </>
  );
}
