import { useState } from 'react';
import { Link2, Lock, Unlink } from 'lucide-react';
import { Alert, Badge, Button, Select, Skeleton, useToast } from '../ui';
import { useAddDependency, useDependencies, useRemoveDependency, useTasks } from '../../api/hooks';
import { messageOf } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { Task } from '../../lib/types';

/** Manages real task-to-task prerequisites. The server prevents self/duplicate/circular links and derives Blocked/Ready/No dependency. */
export function DependencyManager({ task }: { task: Task }) {
  const view = useDependencies(task.id);
  const candidates = useTasks({ status: ['Pending', 'In Progress', 'Completed'], sortBy: 'taskName', sortOrder: 'asc', page: 1, pageSize: 100 });
  const add = useAddDependency(); const remove = useRemoveDependency(); const toast = useToast();
  const [pick, setPick] = useState('');
  const taken = new Set(view.data?.prerequisites.map((p) => p.id));
  const options = (candidates.data?.items ?? []).filter((t) => t.id !== task.id && !taken.has(t.id));

  const onAdd = () => {
    if (!pick) return;
    add.mutate({ taskId: task.id, dependsOnTaskId: pick }, { onSuccess: () => { setPick(''); toast.success('Dependency added'); }, onError: (e) => toast.error(messageOf(e)) });
  };
  return (
    <section aria-label={`Dependencies for ${task.taskName}`} className="mt-4 border-t border-line pt-4">
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4" aria-hidden="true" />Prerequisites
        {view.data && <Badge tone={view.data.dependencyStatus === 'Blocked' ? 'terracotta' : view.data.dependencyStatus === 'Ready' ? 'olive' : 'neutral'}>{view.data.dependencyStatus}</Badge>}</h4>
      {view.isPending ? <Skeleton className="h-10" /> : view.isError ? <Alert tone="error">{messageOf(view.error)}</Alert> : (
        <>
          {view.data.prerequisites.length === 0 ? <p className="text-sm text-muted">This task does not depend on any other task.</p> : (
            <ul className="space-y-1.5">
              {view.data.prerequisites.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">{p.isBlocking && <Lock className="h-3.5 w-3.5 text-terracotta" aria-label="Blocking" />}<span className="font-medium">{p.taskName}</span><span className="text-xs text-muted">{p.status}{p.dueDate ? ` · due ${formatDate(p.dueDate)}` : ''}</span></span>
                  <Button size="sm" variant="ghost" aria-label={`Remove prerequisite ${p.taskName}`} loading={remove.isPending && remove.variables?.prerequisiteId === p.id}
                    onClick={() => remove.mutate({ taskId: task.id, prerequisiteId: p.id }, { onSuccess: () => toast.success('Dependency removed'), onError: (e) => toast.error(messageOf(e)) })}><Unlink className="h-3.5 w-3.5" aria-hidden="true" />Remove</Button>
                </li>))}
            </ul>)}
          {view.data.dependents.length > 0 && <p className="mt-2 text-xs text-muted">Blocks: {view.data.dependents.map((d) => d.taskName).join(', ')}</p>}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1"><label htmlFor={`dep-${task.id}`} className="mb-1 block text-xs font-medium text-muted">Add a prerequisite</label>
              <Select id={`dep-${task.id}`} value={pick} onChange={(e) => setPick(e.target.value)} disabled={candidates.isPending}><option value="">Choose a task…</option>{options.map((t) => <option key={t.id} value={t.id}>{t.taskName} ({t.status})</option>)}</Select></div>
            <Button size="sm" onClick={onAdd} disabled={!pick} loading={add.isPending}>Add dependency</Button>
          </div>
          <p className="mt-2 text-xs text-muted">A task is Blocked while any prerequisite is Pending or In Progress. Completed or cancelled prerequisites no longer block it. Circular links are rejected.</p>
        </>)}
    </section>
  );
}
