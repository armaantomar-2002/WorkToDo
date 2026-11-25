import { Link, useNavigate } from 'react-router-dom';
import { BarChart3, CalendarDays, CheckCircle2, ClipboardList, Clock, Flame, Gauge, Hourglass, Play, Sparkles, Timer, Zap } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Badge, Button, Card, CardHeader, CategoryBadge, EmptyState, ErrorState, ImportanceBadge, ProgressRing, Skeleton, StatCard, StatusBadge } from '../components/ui';
import { useDashboard } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { dueLabel, formatLongDate, formatMinutes, greeting, pct } from '../lib/format';
import { messageOf } from '../lib/api';
import { formatClock } from '../lib/timer';
import { fmtDuration, fmtTime } from '../lib/planner';
import type { DashboardSummary } from '../lib/types';

function PlannerWidget({ p }: { p: NonNullable<DashboardSummary['planner']> }) {
  const status = p.scheduleStatus === 'approved' ? ['olive', 'Schedule active'] : p.scheduleStatus === 'needs_recalculation' ? ['amber', 'Schedule needs updating'] : ['neutral', 'No schedule yet'];
  return (
    <section aria-label="Today's plan" className="mt-6">
      <Card><CardHeader title="Today's plan" action={<Link to="/planner" className="text-sm font-medium text-primary underline">Open planner</Link>} />
        <div className="grid gap-4 px-5 pb-5 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs text-muted">Status</p><p className="mt-1"><Badge tone={status[0] as 'olive' | 'amber' | 'neutral'}>{status[1]}</Badge>{p.hasDraft && <Badge tone="amber" className="ml-1">Draft waiting</Badge>}</p>{p.unscheduledCount ? <p className="mt-1 text-xs text-muted">{p.unscheduledCount} task(s) not placed</p> : null}</div>
          <div><p className="text-xs text-muted">Next session</p><p className="mt-1 text-sm font-medium">{p.nextBlock ? `${fmtTime(p.nextBlock.start)} · ${p.nextBlock.taskName}` : '—'}</p></div>
          <div><p className="text-xs text-muted">Next appointment</p><p className="mt-1 text-sm font-medium">{p.nextAppointment ? `${p.nextAppointment.startAt.slice(0, 10) === p.today ? '' : `${p.nextAppointment.startAt.slice(0, 10)} `}${fmtTime(p.nextAppointment.startAt)} · ${p.nextAppointment.title}` : '—'}</p></div>
          <div><p className="text-xs text-muted">Planned / worked / free today</p><p className="mt-1 text-sm font-medium">{fmtDuration(p.plannedMinutesToday)} / {fmtDuration(p.actualMinutesToday)} / {p.workingToday ? fmtDuration(p.freeMinutesToday) : 'day off'}</p></div>
        </div>
        {p.dueToday.length > 0 && <p className="px-5 pb-4 text-sm text-terracotta-ink">Due today: {p.dueToday.map((x) => x.taskName).join(', ')}</p>}
      </Card>
    </section>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const q = useDashboard();
  const navigate = useNavigate();
  const first = user?.fullName.split(' ')[0] ?? '';

  if (q.isPending) return <><PageHeader title="Dashboard" /><div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="mt-6 h-56" /></>;
  if (q.isError) return <><PageHeader title="Dashboard" /><Card><ErrorState message={messageOf(q.error)} onRetry={() => q.refetch()} /></Card></>;
  const d = q.data;
  const rec = d.todaysRecommendation;

  const startTask = () => {
    if (!rec?.item.taskId) return;
    navigate(`/sessions?task=${rec.item.taskId}`); // the focus timer starts there; starting it marks the task In Progress
  };

  return (
    <>
      <PageHeader title="Dashboard" actions={<span className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm"><CalendarDays className="h-4 w-4 text-muted" aria-hidden="true" />{formatLongDate(d.today)}</span>} />
      <section aria-label="Welcome"><h2 className="text-xl font-semibold">{greeting(new Date().getHours())}, {first} <span aria-hidden="true">👋</span></h2><p className="mt-1 text-sm text-muted">Here's your productivity overview for today.</p></section>

      <section aria-label="Statistics" className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={ClipboardList} tone="dusty" value={d.stats.totalTasks} label="Total Tasks" />
        <StatCard icon={Hourglass} tone="terracotta" value={d.stats.pendingTasks} label="Pending" />
        <StatCard icon={CheckCircle2} tone="olive" value={d.stats.completedTasks} label="Completed" />
        <StatCard icon={BarChart3} tone="amber" value={pct(d.stats.completionPercentage)} label="Completion" />
      </section>

      {d.overdueCount > 0 && <p role="status" className="mt-4 rounded-lg bg-terracotta-soft px-4 py-2.5 text-sm text-terracotta-ink">You have {d.overdueCount} overdue {d.overdueCount === 1 ? 'task' : 'tasks'}. <Link to="/tasks?tab=pending" className="font-semibold underline">Review tasks</Link></p>}

      {d.activeTimer && (
        <Link to="/sessions" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-olive-soft px-4 py-3 text-sm text-olive-ink hover:opacity-90" data-testid="active-timer-banner">
          <span className="flex items-center gap-2"><Timer className="h-4 w-4" aria-hidden="true" /><span><strong>{d.activeTimer.status === 'running' ? 'Focus timer running' : 'Focus timer paused'}</strong>{d.activeTimer.taskName ? ` — ${d.activeTimer.taskName}` : ''} · {formatClock(d.activeTimer.elapsedSeconds)} focused at last update</span></span>
          <span className="font-semibold underline">Open timer</span>
        </Link>)}

      {d.planner && <PlannerWidget p={d.planner} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card aria-label="Today's Recommendation">
          <CardHeader title="Today's Recommendation" />
          <div className="px-5 pb-5 pt-3">
            {rec ? (
              <div>
                <div className="flex flex-wrap items-center gap-3"><h3 className="font-serif text-xl font-semibold">{rec.item.taskName}</h3><CategoryBadge value={rec.item.category} /><span className="text-sm text-muted">Score {rec.item.mlScore.toFixed(1)}</span></div>
                <p className="mt-1 text-sm text-muted">{dueLabel(rec.item.dueDate, d.today)} · {formatMinutes(rec.item.estimatedDurationMinutes)}</p>
                <p className="mt-3 text-sm">{rec.item.reason}</p>
                <Button className="mt-5" onClick={startTask}><Play className="h-4 w-4" aria-hidden="true" /> Start Task</Button>
              </div>
            ) : <EmptyState icon={Sparkles} title="No recommendation yet" message="Tell WorkToDo about your current session to get a ranked plan." action={<Link to="/recommendations"><Button>Get Recommendations</Button></Link>} />}
          </div>
        </Card>

        <Card aria-label="Today's Focus">
          <CardHeader title="Today's Focus" />
          <div className="flex items-center gap-5 px-5 pb-5 pt-4">
            <ProgressRing value={d.todaysFocus.availableTimeMinutes ? 1 : 0} label={d.todaysFocus.availableTimeMinutes ? `${d.todaysFocus.availableTimeMinutes} minutes available` : 'No session planned today'}>
              {d.todaysFocus.availableTimeMinutes ? <><span className="font-serif text-2xl font-semibold leading-none">{d.todaysFocus.availableTimeMinutes} min</span><span className="text-xs text-muted">available</span></> : <span className="px-2 text-xs text-muted">No session today</span>}
            </ProgressRing>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><Zap className="h-4 w-4 text-amber" aria-hidden="true" />Energy: {d.todaysFocus.energyLevel}</li>
              <li className="flex items-center gap-2"><Gauge className="h-4 w-4 text-olive" aria-hidden="true" />Focus: {d.todaysFocus.focusLevel}</li>
              <li className="flex items-center gap-2"><Clock className="h-4 w-4 text-olive" aria-hidden="true" />Period: {d.todaysFocus.currentTimePeriod}</li>
            </ul>
          </div>
          {d.todaysFocus.source === 'preferences' && <p className="border-t border-line px-5 py-3 text-xs text-muted">Showing your default preferences. <Link to="/sessions" className="font-semibold text-terracotta hover:underline">Plan a session</Link></p>}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card><CardHeader title="Recent Tasks" />
          <ul className="divide-y divide-line px-5 pb-3 pt-2">{d.recentTasks.length === 0 ? <li className="py-6 text-center text-sm text-muted">No tasks yet</li> : d.recentTasks.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 py-2.5 text-sm"><span className="truncate">{t.taskName}</span><StatusBadge value={t.status} /></li>)}</ul></Card>
        <Card><CardHeader title="Upcoming Deadlines" />
          <ul className="divide-y divide-line px-5 pb-3 pt-2">{d.upcomingDeadlines.length === 0 ? <li className="py-6 text-center text-sm text-muted">No upcoming deadlines</li> : d.upcomingDeadlines.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 py-2.5 text-sm"><div className="min-w-0"><p className="truncate">{t.taskName}</p><p className="text-xs text-muted">{dueLabel(t.dueDate, d.today)}</p></div><ImportanceBadge value={t.importance} /></li>)}</ul></Card>
        <Card><CardHeader title="Productivity Summary" />
          <dl className="space-y-2.5 px-5 pb-5 pt-3 text-sm">
            {([[Flame, 'Completed today', d.productivity.completedToday], [CheckCircle2, 'Completed (7 days)', d.productivity.completedLast7Days], [Timer, 'Focused today', formatMinutes(Math.round(d.productivity.focusedMinutesToday))], [Timer, 'Focused (7 days)', formatMinutes(Math.round(d.productivity.focusedMinutesLast7Days))], [Clock, 'Timers finished (7 days)', d.productivity.finishedTimersLast7Days], [Hourglass, 'Planned availability (7 days)', formatMinutes(d.productivity.plannedMinutesLast7Days)], [Sparkles, 'Recommendation runs (7 days)', d.productivity.recommendationRunsLast7Days]] as const).map(([Icon, label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2"><dt className="flex items-center gap-2 text-muted"><Icon className="h-4 w-4" aria-hidden="true" />{label}</dt><dd className="font-semibold">{value}</dd></div>
            ))}
          </dl></Card>
      </div>
    </>
  );
}
