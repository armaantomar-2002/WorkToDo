import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { BarChart3, CheckCircle2, ClipboardList, Hourglass, Timer } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Card, CardHeader, EmptyState, ErrorState, Select, Skeleton, StatCard } from '../components/ui';
import { useInsightsSessions, useInsightsSummary, useInsightsTasks } from '../api/hooks';
import { useChartColors } from '../theme/ThemeProvider';
import { formatMinutes, pct, shortDay } from '../lib/format';
import { messageOf } from '../lib/api';

const RANGES = [[7, 'Last 7 Days'], [30, 'Last 30 Days'], [90, 'Last 90 Days']] as const;

function ChartCard({ title, children, empty, emptyText, label }: { title: string; children: ReactNode; empty: boolean; emptyText: string; label: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="px-3 pb-4 pt-3" role="img" aria-label={label}>
        {empty ? <EmptyState icon={BarChart3} title="No data yet" message={emptyText} /> : <div className="h-64">{children}</div>}
      </div>
    </Card>
  );
}

export default function InsightsPage() {
  const [range, setRange] = useState<number>(7);
  const summary = useInsightsSummary(range); const tasks = useInsightsTasks(range); const sessions = useInsightsSessions(range);
  const c = useChartColors();
  const axis = { stroke: c.muted, fontSize: 11 };
  const tooltip = { contentStyle: { background: c.surface, border: `1px solid ${c.line}`, borderRadius: 8, fontSize: 12, color: c.ink } };

  const header = <PageHeader title="Productivity Insights" subtitle="Track your progress and productivity over time."
    actions={<div className="w-40"><Select aria-label="Time range" value={range} onChange={(e) => setRange(Number(e.target.value))}>{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>} />;

  const failed = summary.error ?? tasks.error ?? sessions.error;
  if (failed) return <>{header}<Card><ErrorState message={messageOf(failed)} onRetry={() => { summary.refetch(); tasks.refetch(); sessions.refetch(); }} /></Card></>;
  if (!summary.data || !tasks.data || !sessions.data) return <>{header}<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div><div className="mt-6 grid gap-6 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div></>;

  const t = summary.data.totals;
  const noTasks = t.totalTasks === 0;
  const statusColor: Record<string, string> = { Pending: c.amber, 'In Progress': c.dusty, Completed: c.olive, Cancelled: c.muted };
  const priorityColor: Record<string, string> = { Critical: c.terracotta, High: c.amber, Medium: c.olive, Low: c.dusty };
  const trend = tasks.data.completionTrend.map((d) => ({ ...d, label: shortDay(d.date) }));
  const prod = sessions.data.trend.map((s, i) => ({ label: shortDay(s.date), plannedMinutes: s.plannedMinutes, focusedMinutes: s.focusedMinutes, completed: tasks.data.completionTrend[i]?.completed ?? 0 }));
  const statusData = tasks.data.byStatus.filter((s) => s.count > 0);
  const noSessions = sessions.data.totalSessions === 0 && summary.data.totals.totalSessions === 0;

  return (
    <>
      {header}
      <section aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={ClipboardList} tone="dusty" value={t.totalTasks} label="Total Tasks" />
        <StatCard icon={CheckCircle2} tone="olive" value={t.completedTasks} label="Completed" />
        <StatCard icon={BarChart3} tone="amber" value={pct(t.completionRate)} label="Completion Rate" />
        <StatCard icon={Timer} tone="terracotta" value={t.finishedTimers ? formatMinutes(t.avgFocusMinutes) : '—'} label="Avg. Focus Time" />
      </section>
      <p className="mt-2 text-xs text-muted">Cards show all-time totals ({t.pendingTasks} pending). Avg. Focus Time is the average ACTUAL focused time per finished timer (pauses excluded), not planned availability. Charts follow the selected range.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <ChartCard title="Task Completion Trend" empty={noTasks} emptyText="Add and complete tasks to see your trend." label={`Tasks completed per day over the last ${range} days: ${summary.data.inRange.completed} completed, ${summary.data.inRange.created} created`}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tooltip} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="completed" name="Completed" stroke={c.olive} strokeWidth={2.5} dot={range <= 30} activeDot={{ r: 5 }} /><Line type="monotone" dataKey="created" name="Created" stroke={c.dusty} strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </LineChart></ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tasks by Status" empty={noTasks} emptyText="Your task statuses will appear here." label={`Tasks by status: ${tasks.data.byStatus.map((s) => `${s.name} ${s.count}`).join(', ')}`}>
          <div className="relative h-full">
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statusData} dataKey="count" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke={c.surface}>{statusData.map((s) => <Cell key={s.name} fill={statusColor[s.name]} />)}</Pie><Tooltip {...tooltip} /><Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => `${v} (${tasks.data.byStatus.find((s) => s.name === v)?.count ?? 0})`} /></PieChart></ResponsiveContainer>
            <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center"><span className="font-serif text-3xl font-semibold">{t.totalTasks}</span><span className="block text-xs text-muted">Tasks</span></div>
          </div>
        </ChartCard>

        <ChartCard title="Priority Distribution" empty={noTasks} emptyText="Add tasks with different importance levels." label={`Tasks by importance: ${tasks.data.byImportance.map((s) => `${s.name} ${s.count}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%"><BarChart data={tasks.data.byImportance} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tooltip} cursor={{ fill: c.line, opacity: 0.4 }} />
            <Bar dataKey="count" name="Tasks" radius={[6, 6, 0, 0]}>{tasks.data.byImportance.map((s) => <Cell key={s.name} fill={priorityColor[s.name]} />)}</Bar>
          </BarChart></ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Productivity Over Time" empty={noTasks && noSessions && summary.data.inRange.finishedTimers === 0} emptyText="Run the focus timer, plan sessions and complete tasks to see this chart." label={`Planned availability, actual focused minutes and completed tasks per day over the last ${range} days`}>
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={prod} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
            <YAxis yAxisId="m" {...axis} /><YAxis yAxisId="t" orientation="right" allowDecimals={false} {...axis} /><Tooltip {...tooltip} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="m" dataKey="plannedMinutes" name="Planned availability (min)" fill={c.amber} opacity={0.45} radius={[4, 4, 0, 0]} /><Bar yAxisId="m" dataKey="focusedMinutes" name="Actual focused (min)" fill={c.olive} radius={[4, 4, 0, 0]} /><Line yAxisId="t" type="monotone" dataKey="completed" name="Tasks completed" stroke={c.terracotta} strokeWidth={2.5} dot={false} />
          </ComposedChart></ResponsiveContainer>
        </ChartCard>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><Hourglass className="h-3.5 w-3.5" aria-hidden="true" />In this range: {summary.data.inRange.completed} completed · {summary.data.inRange.created} created · {summary.data.inRange.sessions} planned sessions · {formatMinutes(summary.data.inRange.plannedMinutes)} planned · {formatMinutes(Math.round(summary.data.inRange.focusedMinutes))} actually focused across {summary.data.inRange.finishedTimers} timers (days in {summary.data.timeZone}).</p>
    </>
  );
}
