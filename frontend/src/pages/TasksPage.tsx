import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, CalendarClock, Eye, Timer as TimerIcon, Lock, ListFilter, Pencil, Plus, Search, Trash2, ClipboardList } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, ImportanceBadge, Input, Modal, Pagination, PillTabs, Select, Skeleton, StatusBadge, useToast } from '../components/ui';
import { PostponeDialog } from '../components/planner/PlannerDialogs';
import { useDashboard, useDeleteTask, useSetTaskStatus, useTasks } from '../api/hooks';
import { TaskFormModal } from './TaskFormModal';
import { DependencyManager } from '../components/tasks/DependencyManager';
import { formatDate, formatMinutes } from '../lib/format';
import { messageOf } from '../lib/api';
import { useDebounced } from '../lib/useDebounced';
import { IMPORTANCE, TASK_STATUS, type Importance, type Task, type TaskStatus } from '../lib/types';

type Tab = 'all' | 'pending' | 'completed';
const SORTS = [['createdAt', 'Date created'], ['dueDate', 'Due date'], ['importance', 'Importance'], ['taskName', 'Name'], ['status', 'Status'], ['estimatedDurationMinutes', 'Duration']] as const;

function TaskDetails({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const rows: [string, string][] = task ? [
    ['Status', task.status], ['Importance', task.importance], ['Goal contribution', task.goalContribution], ['Consequence of delay', task.consequenceOfDelay],
    ['Estimated duration', formatMinutes(task.estimatedDurationMinutes)], ['Splittable', task.isSplittable ? `Yes (min. session ${formatMinutes(task.minimumSessionMinutes)})` : 'No'], ['Preferred time', task.preferredTime],
    ['Dependency', task.dependencyStatus], ['Start date', formatDate(task.startDate)], ['Due date', formatDate(task.dueDate)], ['Completed', task.completedAt ? formatDate(task.completedAt.slice(0, 10)) : '—'],
  ] : [];
  return (
    <Modal open={!!task} onClose={onClose} title={task?.taskName ?? 'Task'} wide footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {task?.description && <p className="mb-4 whitespace-pre-wrap text-sm">{task.description}</p>}
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{rows.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>
      {task && (task.status === 'Pending' || task.status === 'In Progress') && <Link to={`/sessions?task=${task.id}`} onClick={onClose} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-2"><TimerIcon className="h-4 w-4" aria-hidden="true" />Start a focus timer for this task</Link>}
      {task && <DependencyManager task={task} />}
    </Modal>
  );
}

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const tab = (['all', 'pending', 'completed'].includes(params.get('tab') ?? '') ? params.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim());
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'' | TaskStatus>('');
  const [importanceFilter, setImportanceFilter] = useState<'' | Importance>('');
  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Task | null>(null);
  const [postponing, setPostponing] = useState<Task | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const toast = useToast();

  useEffect(() => { setPage(1); }, [tab, debounced, statusFilter, importanceFilter, sortBy, sortOrder]);
  const status: TaskStatus[] | undefined = tab === 'pending' ? ['Pending', 'In Progress'] : tab === 'completed' ? ['Completed'] : statusFilter ? [statusFilter] : undefined;
  const tasks = useTasks({ search: debounced || undefined, status, importance: importanceFilter ? [importanceFilter] : undefined, sortBy, sortOrder, page, pageSize: 10 });
  const counts = useDashboard();
  const setStatus = useSetTaskStatus();
  const del = useDeleteTask();

  const toggle = async (t: Task) => {
    try { await setStatus.mutateAsync({ id: t.id, status: t.status === 'Completed' ? 'Pending' : 'Completed' }); toast.success(t.status === 'Completed' ? 'Task reopened' : 'Task completed'); }
    catch (e) { toast.error(messageOf(e)); }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try { await del.mutateAsync(deleting.id); toast.success('Task deleted'); setDeleting(null); } catch (e) { toast.error(messageOf(e)); }
  };
  const openNew = () => { setEditing(null); setFormOpen(true); };
  const stats = counts.data?.stats;
  const data = tasks.data;
  const filtered = !!(debounced || statusFilter || importanceFilter || tab !== 'all');

  return (
    <>
      <PageHeader title="My Tasks" subtitle="Create, manage and track all your tasks." actions={<Button onClick={openNew}><Plus className="h-4 w-4" aria-hidden="true" />Add Task</Button>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PillTabs<Tab> label="Task filter" value={tab} onChange={(v) => setParams(v === 'all' ? {} : { tab: v })}
          items={[{ value: 'all', label: 'All', count: stats?.totalTasks }, { value: 'pending', label: 'Pending', count: stats?.pendingTasks }, { value: 'completed', label: 'Completed', count: stats?.completedTasks }]} />
        <div className="flex items-center gap-2">
          <div className="w-56"><Input aria-label="Search tasks" icon={Search} placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Button variant="secondary" aria-expanded={showFilters} aria-controls="task-filters" onClick={() => setShowFilters((s) => !s)} aria-label="Filters"><ListFilter className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </div>
      {showFilters && (
        <Card id="task-filters" className="mb-4 grid gap-3 p-4 sm:grid-cols-4">
          <label className="text-xs font-medium text-muted">Status<Select aria-label="Filter by status" value={tab === 'all' ? statusFilter : ''} disabled={tab !== 'all'} onChange={(e) => setStatusFilter(e.target.value as '' | TaskStatus)}><option value="">All statuses</option>{TASK_STATUS.map((s) => <option key={s}>{s}</option>)}</Select></label>
          <label className="text-xs font-medium text-muted">Importance<Select aria-label="Filter by importance" value={importanceFilter} onChange={(e) => setImportanceFilter(e.target.value as '' | Importance)}><option value="">All</option>{IMPORTANCE.map((s) => <option key={s}>{s}</option>)}</Select></label>
          <label className="text-xs font-medium text-muted">Sort by<Select aria-label="Sort by" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
          <label className="text-xs font-medium text-muted">Order<Select aria-label="Sort order" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}><option value="desc">Descending</option><option value="asc">Ascending</option></Select></label>
        </Card>
      )}

      <Card className="overflow-hidden">
        {tasks.isPending ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          : tasks.isError ? <ErrorState message={messageOf(tasks.error)} onRetry={() => tasks.refetch()} />
          : data && data.items.length === 0 ? (filtered
            ? <EmptyState icon={Search} title="No matching tasks" message="Try a different search or clear the filters." />
            : <EmptyState icon={ClipboardList} title="No tasks yet" message="Add your first task to start getting recommendations." action={<Button onClick={openNew}><Plus className="h-4 w-4" aria-hidden="true" />Add Task</Button>} />)
          : data && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b border-line text-xs text-muted"><tr>
                    <th className="w-10 px-4 py-3"><span className="sr-only">Complete</span></th><th className="px-2 py-3 font-semibold">Task</th><th className="px-3 py-3 font-semibold">Due Date</th>
                    <th className="px-3 py-3 font-semibold">Importance</th><th className="px-3 py-3 font-semibold">Status</th><th className="px-4 py-3 text-right font-semibold">Actions</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {data.items.map((t) => (
                      <tr key={t.id} className="hover:bg-surface-2/60">
                        <td className="px-4 py-3"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={t.status === 'Completed'} onChange={() => toggle(t)} aria-label={t.status === 'Completed' ? `Reopen ${t.taskName}` : `Mark ${t.taskName} completed`} /></td>
                        <td className="px-2 py-3"><button type="button" className="text-left font-semibold hover:underline" onClick={() => setViewing(t)}>{t.taskName}</button>{t.dependencyStatus === 'Blocked' && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-terracotta-soft px-2 py-0.5 text-[11px] font-semibold text-terracotta-ink" title="Waiting on an unfinished prerequisite"><Lock className="h-3 w-3" aria-hidden="true" />Blocked</span>}{t.description && <p className="max-w-xs truncate text-xs text-muted">{t.description}</p>}</td>
                        <td className="px-3 py-3 text-muted">{t.dueDate ? formatDate(t.dueDate) : '—'}</td>
                        <td className="px-3 py-3"><ImportanceBadge value={t.importance} /></td>
                        <td className="px-3 py-3"><StatusBadge value={t.status} /></td>
                        <td className="px-4 py-3"><div className="flex justify-end gap-1">
                          <button type="button" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`View ${t.taskName}`} onClick={() => setViewing(t)}><Eye className="h-4 w-4" /></button>
                          {(t.status === 'Pending' || t.status === 'In Progress') && <button type="button" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Postpone ${t.taskName}`} onClick={() => setPostponing(t)}><CalendarClock className="h-4 w-4" /></button>}
                          <button type="button" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Edit ${t.taskName}`} onClick={() => { setEditing(t); setFormOpen(true); }}><Pencil className="h-4 w-4" /></button>
                          <button type="button" className="rounded p-1.5 text-terracotta hover:bg-terracotta-soft" aria-label={`Delete ${t.taskName}`} onClick={() => setDeleting(t)}><Trash2 className="h-4 w-4" /></button>
                        </div></td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} noun={data.total === 1 ? 'task' : 'tasks'} />
            </>)}
      </Card>
      <p className="mt-2 text-xs text-muted" aria-hidden="true">{sortOrder === 'asc' ? <ArrowUp className="mr-1 inline h-3 w-3" /> : <ArrowDown className="mr-1 inline h-3 w-3" />}Sorted by {SORTS.find(([v]) => v === sortBy)?.[1].toLowerCase()}</p>

      <TaskFormModal open={formOpen} task={editing} onClose={() => setFormOpen(false)} />
      <TaskDetails task={viewing} onClose={() => setViewing(null)} />
      <PostponeDialog task={postponing} onClose={() => setPostponing(null)} />
      <ConfirmDialog open={!!deleting} title="Delete task?" message={<>“{deleting?.taskName}” will be removed from your task list. Past recommendation history keeps its own copy.</>} loading={del.isPending} onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
    </>
  );
}
