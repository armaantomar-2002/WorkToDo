import { useState } from 'react';
import { History } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Pagination, Skeleton } from '../ui';
import { useTimerHistory } from '../../api/hooks';
import { messageOf } from '../../lib/api';
import { formatInstant } from '../../lib/format';
import { formatDuration } from '../../lib/timer';

export function TimerHistory() {
  const [page, setPage] = useState(1);
  const q = useTimerHistory(page);
  return (
    <Card>
      <CardHeader title="Focus History" action={<span className="text-xs text-muted">Planned vs actual focused time (pauses excluded)</span>} />
      {q.isPending ? <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        : q.isError ? <ErrorState message={messageOf(q.error)} onRetry={() => q.refetch()} />
        : q.data.items.length === 0 ? <EmptyState icon={History} title="No focus sessions yet" message="Start the timer above. Finished and cancelled sessions are listed here." />
        : (
          <>
            <div className="overflow-x-auto px-2 pt-2">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="sr-only">Focus timer history</caption>
                <thead><tr className="text-xs uppercase tracking-wide text-muted"><th scope="col" className="px-3 py-2 font-medium">Task</th><th scope="col" className="px-3 py-2 font-medium">Started</th><th scope="col" className="px-3 py-2 font-medium">Planned</th><th scope="col" className="px-3 py-2 font-medium">Actual</th><th scope="col" className="px-3 py-2 font-medium">Paused</th><th scope="col" className="px-3 py-2 font-medium">Result</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {q.data.items.map((t) => (
                    <tr key={t.id} data-testid="timer-history-row">
                      <td className="px-3 py-2.5 font-medium">{t.taskName ?? 'General focus time'}</td>
                      <td className="px-3 py-2.5 text-muted">{formatInstant(t.startedAt)}</td>
                      <td className="px-3 py-2.5">{formatDuration(t.plannedSeconds)}</td>
                      <td className="px-3 py-2.5 font-semibold">{formatDuration(t.elapsedSeconds)}{t.isOvertime && <span className="ml-1 text-xs font-normal text-amber-ink">(+{formatDuration(t.overtimeSeconds)})</span>}</td>
                      <td className="px-3 py-2.5 text-muted">{t.pauses.length ? `${formatDuration(t.pausedSeconds)} · ${t.pauses.length}×` : '—'}</td>
                      <td className="px-3 py-2.5"><Badge tone={t.status === 'finished' ? 'olive' : 'neutral'}>{t.status === 'finished' ? 'Finished' : 'Cancelled'}</Badge></td>
                    </tr>))}
                </tbody>
              </table>
            </div>
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} onPage={setPage} noun="sessions" />
          </>)}
    </Card>
  );
}
