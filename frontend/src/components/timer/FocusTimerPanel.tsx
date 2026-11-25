import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pause, Play, Square, Timer as TimerIcon, X } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, FormField, Input, ProgressRing, Select, Skeleton, Spinner, useToast } from '../ui';
import { useActiveTimer, useStartTimer, useTasks, useTimerAction, type TimerAction } from '../../api/hooks';
import { ApiError, messageOf } from '../../lib/api';
import { displayElapsed, formatClock, formatDuration, splitRemaining } from '../../lib/timer';
import { formatInstant } from '../../lib/format';
import type { FocusTimer } from '../../lib/types';
import { useQueryClient } from '@tanstack/react-query';

/** Re-renders every second; the VALUE shown always derives from server data + a wall-clock delta (see lib/timer.ts). */
function useTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    const wake = () => setNow(Date.now());
    document.addEventListener('visibilitychange', wake);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', wake); };
  }, [active]);
  return now;
}

function ActiveTimer({ timer, fetchedAt }: { timer: FocusTimer; fetchedAt: number }) {
  const act = useTimerAction(); const toast = useToast();
  const qc = useQueryClient();
  const now = useTicker(timer.status === 'running');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [completeTask, setCompleteTask] = useState(false);
  const elapsed = displayElapsed(timer, fetchedAt, now);
  const { remaining, overtime } = splitRemaining(timer.plannedSeconds, elapsed);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  const run = (action: TimerAction, ok: string, extra?: { completeTask?: boolean }) => act.mutate({ id: timer.id, action, ...extra }, {
    onSuccess: () => { toast.success(ok); setConfirmCancel(false); setFinishing(false); },
    onError: (e) => {
      setConfirmCancel(false); setFinishing(false);
      if (e instanceof ApiError && e.code === 'network_error') toast.error('No connection. Your timer keeps running on the server; try again when you are back online.');
      else if (e instanceof ApiError && e.status === 409) toast.error(`${messageOf(e)}. Timer refreshed.`);
      else toast.error(messageOf(e));
      qc.invalidateQueries({ queryKey: ['timer'] });
    },
  });
  const busy = act.isPending;

  return (
    <div className="px-5 pb-5 pt-4" data-testid="active-timer">
      {offline && <Alert tone="warning">You appear to be offline. The timer is stored on the server and will be correct when you reconnect.</Alert>}
      <div className="flex flex-wrap items-center gap-6">
        <ProgressRing value={timer.plannedSeconds ? Math.min(1, elapsed / timer.plannedSeconds) : 0} size={150} stroke={12} label={`${Math.round(Math.min(100, (elapsed / timer.plannedSeconds) * 100))}% of planned time used`}>
          <span className="font-serif text-3xl font-semibold tabular-nums" data-testid="timer-main">{overtime > 0 ? `+${formatClock(overtime)}` : formatClock(remaining)}</span>
          <span className="text-[11px] uppercase tracking-wide text-muted">{overtime > 0 ? 'overtime' : 'remaining'}</span>
        </ProgressRing>
        <div className="min-w-0 flex-1 space-y-1.5 text-sm">
          <p className="flex flex-wrap items-center gap-2"><span className="font-serif text-lg font-semibold">{timer.taskName ?? 'Unassigned focus time'}</span><Badge tone={timer.status === 'running' ? 'olive' : 'amber'}>{timer.status === 'running' ? 'Running' : 'Paused'}</Badge></p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted">
            <div><dt className="inline">Elapsed focus: </dt><dd className="inline font-semibold text-ink tabular-nums" data-testid="timer-elapsed">{formatClock(elapsed)}</dd></div>
            <div><dt className="inline">Planned: </dt><dd className="inline font-semibold text-ink">{formatDuration(timer.plannedSeconds)}</dd></div>
            <div><dt className="inline">Paused so far: </dt><dd className="inline font-semibold text-ink">{formatDuration(timer.pausedSeconds)}</dd></div>
            <div><dt className="inline">Started: </dt><dd className="inline font-semibold text-ink">{formatInstant(timer.startedAt)}</dd></div>
            <div><dt className="inline">Pauses: </dt><dd className="inline font-semibold text-ink">{timer.pauses.length}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2 pt-2">
            {timer.status === 'running'
              ? <Button onClick={() => run('pause', 'Timer paused')} loading={busy} disabled={busy}><Pause className="h-4 w-4" aria-hidden="true" />Pause</Button>
              : <Button onClick={() => run('resume', 'Timer resumed')} loading={busy} disabled={busy}><Play className="h-4 w-4" aria-hidden="true" />Resume</Button>}
            <Button variant="secondary" onClick={() => { setCompleteTask(false); setFinishing(true); }} disabled={busy}><Square className="h-4 w-4" aria-hidden="true" />Finish</Button>
            <Button variant="ghost" onClick={() => setConfirmCancel(true)} disabled={busy}><X className="h-4 w-4" aria-hidden="true" />Cancel</Button>
          </div>
        </div>
      </div>
      <ConfirmDialog open={confirmCancel} title="Cancel this focus timer?" message="The time focused so far is kept in your history as cancelled." confirmLabel="Cancel timer" loading={busy} onCancel={() => setConfirmCancel(false)} onConfirm={() => run('cancel', 'Timer cancelled')} />
      <ConfirmDialog open={finishing} title="Finish this focus timer?" confirmLabel="Finish" loading={busy} onCancel={() => setFinishing(false)} onConfirm={() => run('finish', 'Focus session recorded', { completeTask })}
        message={<div className="space-y-3"><p>You focused for {formatClock(elapsed)} (planned {formatDuration(timer.plannedSeconds)}).</p>
          {timer.taskId && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--olive))]" checked={completeTask} onChange={(e) => setCompleteTask(e.target.checked)} />Also mark “{timer.taskName}” as completed</label>}</div>} />
    </div>
  );
}

function StartTimer() {
  const [params] = useSearchParams();
  const tasks = useTasks({ status: ['Pending', 'In Progress'], sortBy: 'taskName', sortOrder: 'asc', page: 1, pageSize: 100 });
  const start = useStartTimer(); const toast = useToast();
  const [taskId, setTaskId] = useState(params.get('task') ?? '');
  const [minutes, setMinutes] = useState<number>(25);
  const [touchedMinutes, setTouchedMinutes] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const selected = useMemo(() => tasks.data?.items.find((t) => t.id === taskId), [tasks.data, taskId]);
  useEffect(() => { if (taskId && tasks.data && !selected) setTaskId(''); }, [taskId, tasks.data, selected]);
  useEffect(() => { if (selected && !touchedMinutes) setMinutes(Math.min(720, selected.estimatedDurationMinutes)); }, [selected, touchedMinutes]);
  const invalid = !Number.isInteger(minutes) || minutes < 1 || minutes > 720;

  const go = () => {
    setSubmitted(true); if (invalid) return;
    start.mutate({ taskId: taskId || null, plannedDurationMinutes: minutes }, {
      onSuccess: () => toast.success('Focus timer started'),
      onError: (e) => toast.error(messageOf(e)),
    });
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(); }} noValidate className="grid gap-4 px-5 pb-5 pt-4 sm:grid-cols-[1fr_160px_auto] sm:items-end" aria-label="Start a focus timer">
      <FormField label="Task (optional)" htmlFor="timerTask">
        <Select id="timerTask" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={tasks.isPending}>
          <option value="">No task — general focus time</option>
          {tasks.data?.items.map((t) => <option key={t.id} value={t.id}>{t.taskName}{t.dependencyStatus === 'Blocked' ? ' (blocked)' : ''}</option>)}
        </Select>
      </FormField>
      <FormField label="Planned (minutes)" htmlFor="timerMinutes" error={submitted && invalid ? 'Enter 1–720 minutes' : undefined}>
        <Input id="timerMinutes" type="number" min={1} max={720} value={Number.isNaN(minutes) ? '' : minutes} invalid={submitted && invalid} onChange={(e) => { setTouchedMinutes(true); setMinutes(e.target.valueAsNumber); }} />
      </FormField>
      <Button type="submit" loading={start.isPending}><Play className="h-4 w-4" aria-hidden="true" />Start Focus</Button>
      {selected?.dependencyStatus === 'Blocked' && <p className="text-xs text-terracotta sm:col-span-3" role="status">This task is blocked by an unfinished prerequisite. You can still focus on it, but consider finishing the prerequisite first. <Link to="/tasks" className="font-semibold underline">Manage dependencies</Link></p>}
    </form>
  );
}

export function FocusTimerPanel() {
  const active = useActiveTimer();
  return (
    <Card>
      <CardHeader title="Focus Timer" action={<span className="flex items-center gap-1.5 text-xs text-muted"><TimerIcon className="h-4 w-4" aria-hidden="true" />Saved on the server — survives refresh and navigation</span>} />
      {active.isPending ? <div className="p-5"><Skeleton className="h-32" /></div>
        : active.isError ? <div className="p-5"><Alert tone="error">{messageOf(active.error)} <button type="button" className="font-semibold underline" onClick={() => active.refetch()}>Retry</button></Alert></div>
        : active.data ? <ActiveTimer key={active.data.id} timer={active.data} fetchedAt={active.dataUpdatedAt} />
        : <StartTimer />}
      {active.isFetching && !active.isPending && <span className="sr-only"><Spinner label="Syncing timer" /></span>}
    </Card>
  );
}
