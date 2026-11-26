import { AlertTriangle, CalendarClock, Coffee, Lock } from 'lucide-react';
import { Alert, Badge } from '../ui';
import { formatLongDate, formatMinutes, formatTimeRange } from '../../lib/format';
import type { ScheduleView, TimelineItem } from '../../lib/types';

/**
 * THE one place a schedule is listed. The Recommendations page and the Planner both render this component from the SAME
 * `ScheduleView.timeline` returned by the server, so tasks, order, start/end times and split sessions can never differ between them.
 * Nothing here computes or adjusts a time.
 */
const KIND_LABEL: Record<TimelineItem['kind'], string> = { fixed: 'Fixed appointment', task: 'Task', break: 'Break' };

function Row({ item }: { item: TimelineItem }) {
  const fixed = item.kind === 'fixed'; const brk = item.kind === 'break';
  const open = item.prerequisites.filter((p) => p.status === 'Pending' || p.status === 'In Progress');
  return (
    <li className={`flex flex-wrap items-start gap-x-4 gap-y-1 rounded-lg border px-4 py-3 ${fixed ? 'border-terracotta/40 bg-terracotta/5' : brk ? 'border-line bg-surface-2/60' : 'border-line bg-surface'}`} data-testid="timeline-item" data-kind={item.kind}>
      <div className="w-48 shrink-0">
        <p className="font-serif text-lg font-semibold leading-tight" data-testid="time-interval">{formatTimeRange(item.start, item.end)}</p>
        <p className="text-xs text-muted">{formatMinutes(item.durationMinutes)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {fixed ? <Lock className="h-4 w-4 text-terracotta" aria-hidden="true" /> : brk ? <Coffee className="h-4 w-4 text-muted" aria-hidden="true" /> : <CalendarClock className="h-4 w-4 text-olive-ink" aria-hidden="true" />}
          <h3 className="font-semibold">{item.title}</h3>
          <Badge tone={fixed ? 'terracotta' : brk ? 'neutral' : 'olive'}>{KIND_LABEL[item.kind]}</Badge>
          {item.sessionCount > 1 && <Badge tone="dusty">Session {item.sessionIndex} of {item.sessionCount}</Badge>}
        </div>
        {item.reason && <p className="mt-1 text-sm text-muted">{item.reason}</p>}
        {open.length > 0 && <p className="mt-1 text-xs text-muted">Prerequisites: {open.map((p) => `${p.taskName} (${p.status})`).join(', ')}</p>}
        {item.warnings.length > 0 && <p className="mt-1 text-xs font-medium text-terracotta">{item.warnings.join(' · ')}</p>}
      </div>
    </li>
  );
}

export function ScheduleTimeline({ view, showUnscheduled = true }: { view: ScheduleView; showUnscheduled?: boolean }) {
  const days: { day: string; items: TimelineItem[] }[] = [];
  for (const it of view.timeline) { const day = it.start.slice(0, 10); const last = days[days.length - 1]; if (last && last.day === day) last.items.push(it); else days.push({ day, items: [it] }); }
  return (
    <div className="space-y-4" data-testid="schedule-timeline" data-schedule-id={view.schedule.id}>
      {view.infeasibilities.map((f, i) => (
        <Alert key={`${f.code}-${i}`} tone="warning">
          <div className="space-y-1.5" data-testid="infeasible">
            <p className="font-semibold"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden="true" />{f.message}</p>
            <p className="text-xs">Needs {formatMinutes(f.requiredMinutes)} · available {formatMinutes(f.availableMinutes)} · short by {formatMinutes(f.shortfallMinutes)}. Causing tasks: {f.tasks.map((t) => `${t.taskName} (${formatMinutes(t.remainingMinutes)}${t.scheduled ? '' : ', not placed'})`).join(', ')}.</p>
            <ul className="list-disc pl-5 text-xs">{f.alternatives.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
        </Alert>))}
      {days.length === 0 ? <p className="text-sm text-muted">Nothing is scheduled yet.</p> : days.map(({ day, items }) => (
        <section key={day} aria-label={formatLongDate(day)}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{formatLongDate(day)}</h2>
          <ol className="space-y-2">{items.map((it) => <Row key={it.key} item={it} />)}</ol>
        </section>))}
      {showUnscheduled && view.unscheduled.length > 0 && (
        <section aria-label="Not scheduled">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-terracotta">Not scheduled ({view.unscheduled.length})</h2>
          <ul className="space-y-2" data-testid="unscheduled">{view.unscheduled.map((u) => (
            <li key={u.taskId} className="rounded-lg border border-dashed border-terracotta/50 px-4 py-3 text-sm"><span className="font-semibold">{u.taskName}</span> <Badge tone="terracotta">Unscheduled</Badge>
              <p className="mt-0.5 text-xs text-muted">{u.message}</p></li>))}</ul>
        </section>)}
    </div>
  );
}
