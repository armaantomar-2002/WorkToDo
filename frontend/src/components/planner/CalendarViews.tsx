// Day / week time grid and month grid. Pure presentation + drag-and-drop wiring; every move is validated by the backend.
import { useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import type { CalendarAppointment, CalendarBlock, CalendarData, UnavailablePeriod } from '../../lib/types';
import { dateOf, daysIn, dropToStart, fmtDay, fmtDuration, fmtTime, gridHours, layoutLanes, minutesBetween, minutesOfDay, rangeFor, WEEKDAYS, weekday, type View } from '../../lib/planner';

const PX = 1; // pixels per minute (60 px per hour)
export interface GridCallbacks {
  onBlock: (b: CalendarBlock, mode: 'draft' | 'active') => void;
  onAppointment: (a: CalendarAppointment) => void;
  onEmpty: (date: string, start: string) => void;
  onMove: (b: CalendarBlock, newStart: string) => void;
  onOpenDay: (date: string) => void;
}
interface Props extends GridCallbacks { data: CalendarData; view: Exclude<View, 'month'>; anchor: string; show: 'draft' | 'active'; canEdit: boolean }

type Item = { key: string; kind: 'block' | 'appt' | 'off'; start: string; end: string; block?: CalendarBlock; appt?: CalendarAppointment; off?: UnavailablePeriod };
const clip = (date: string, s: string, e: string) => { const ds = `${date}T00:00`; const de = `${date}T23:59`; return { start: s < ds ? ds : s, end: e > de ? de : e }; };

export function TimeGrid({ data, view, anchor, show, canEdit, onBlock, onAppointment, onEmpty, onMove }: Props) {
  const { from, to } = rangeFor(view, anchor); const days = daysIn(from, to);
  const blocks = show === 'draft' ? data.draftBlocks : data.approvedBlocks;
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const b of blocks) out.push({ key: b.id, kind: 'block', start: b.start, end: b.end, block: b });
    for (const a of data.appointments) if (a.status === 'scheduled') out.push({ key: a.id, kind: 'appt', start: a.startAt, end: a.endAt, appt: a });
    for (const u of data.unavailable) out.push({ key: u.id, kind: 'off', start: u.startAt, end: u.endAt, off: u });
    return out;
  }, [blocks, data.appointments, data.unavailable]);
  const workingToday = data.workingHours;
  const { startHour, endHour } = gridHours({ start: workingToday.start, end: workingToday.end }, items.filter((i) => days.includes(dateOf(i.start))));
  const startMin = startHour * 60; const height = (endHour - startHour) * 60 * PX;
  const [over, setOver] = useState<string | null>(null); const grab = useRef(0); const dragging = useRef<CalendarBlock | null>(null);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const nowDate = dateOf(data.now); const nowTop = (minutesOfDay(data.now) - startMin) * PX;

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface" role="region" aria-label={`${view === 'day' ? 'Day' : 'Week'} calendar`}>
      <div className={cn('grid', view === 'week' ? 'min-w-[720px]' : 'min-w-[320px]')} style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="sticky top-0 z-10 border-b border-line bg-surface" />
        {days.map((d) => {
          const info = data.days.find((x) => x.date === d);
          return (
            <div key={d} className={cn('sticky top-0 z-10 border-b border-l border-line bg-surface px-2 py-2 text-center text-xs', d === data.today && 'bg-primary/5')}>
              <div className={cn('font-medium', d === data.today && 'text-primary')}>{fmtDay(d)}</div>
              <div className="text-muted">{info?.working ? `${fmtDuration(info.freeMinutes)} free` : 'Day off'}</div>
            </div>
          );
        })}
        <div className="relative" style={{ height }}>
          {hours.map((h) => <div key={h} className="absolute right-1 -translate-y-2 text-[10px] text-muted" style={{ top: (h - startHour) * 60 * PX }}>{h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}</div>)}
        </div>
        {days.map((d) => {
          const info = data.days.find((x) => x.date === d); const w = info?.working;
          const here = items.filter((i) => dateOf(i.start) === d || (dateOf(i.start) < d && i.end > `${d}T00:00`));
          const placed = layoutLanes(here, (i) => { const c = clip(d, i.start, i.end); return { start: minutesOfDay(c.start), end: Math.max(minutesOfDay(c.end), minutesOfDay(c.start) + 15) }; });
          return (
            <div key={d} data-testid={`col-${d}`} className={cn('relative border-l border-line', over === d && 'bg-primary/5')} style={{ height }}
              onClick={(e) => { if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.bg) return; const r = e.currentTarget.getBoundingClientRect(); onEmpty(d, dropToStart(d, e.clientY - r.top, PX, startMin)); }}
              onDragOver={(e) => { if (!canEdit || !dragging.current) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(d); }}
              onDragLeave={() => setOver((o) => (o === d ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const b = dragging.current; dragging.current = null; if (!b || !canEdit) return; const r = e.currentTarget.getBoundingClientRect(); onMove(b, dropToStart(d, e.clientY - r.top, PX, startMin, grab.current)); }}>
              {w && <div data-bg="1" className="absolute inset-x-0 bg-surface-2/40" style={{ top: (minutesOfDay(`${d}T${w.start}`) - startMin) * PX, height: (minutesOfDay(`${d}T${w.end === '24:00' ? '23:59' : w.end}`) - minutesOfDay(`${d}T${w.start}`)) * PX }} />}
              {!w && <div data-bg="1" className="absolute inset-0 bg-surface-2/70" />}
              {hours.map((h) => <div key={h} data-bg="1" className="absolute inset-x-0 border-t border-line/60" style={{ top: (h - startHour) * 60 * PX }} />)}
              {d === nowDate && nowTop >= 0 && nowTop <= height && <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-terracotta" style={{ top: nowTop }} aria-label="Current time" />}
              {placed.map((p) => {
                const c = clip(d, p.item.start, p.item.end); const top = (p.start - startMin) * PX; const h = Math.max(18, (Math.max(p.end, p.start + 15) - p.start) * PX);
                const style = { top, height: h, left: `calc(${(p.lane / p.lanes) * 100}% + 1px)`, width: `calc(${100 / p.lanes}% - 2px)` };
                if (p.item.kind === 'off') return <div key={p.item.key} style={style} className="absolute z-[1] overflow-hidden rounded border border-dashed border-line bg-surface-2 px-1 text-[10px] text-muted" title={`Unavailable: ${p.item.off?.label ?? 'Unavailable'}`}>{p.item.off?.label ?? 'Unavailable'}</div>;
                if (p.item.kind === 'appt') { const a = p.item.appt!; return (
                  <button key={p.item.key} type="button" style={style} onClick={(e) => { e.stopPropagation(); onAppointment(a); }} aria-label={`Appointment ${a.title}, ${fmtTime(a.startAt)} to ${fmtTime(a.endAt)}`}
                    className="absolute z-[2] overflow-hidden rounded border border-dusty bg-dusty-soft px-1 py-0.5 text-left text-[11px] text-dusty-ink hover:shadow-card"><span className="font-medium">{a.title}</span><br />{fmtTime(a.startAt)}</button>); }
                const b = p.item.block!; const isBreak = b.kind === 'break'; const draggable = canEdit && b.status !== 'skipped';
                return (
                  <button key={p.item.key} type="button" style={style} draggable={draggable} data-block-id={b.id}
                    onDragStart={(e) => { dragging.current = b; const r = e.currentTarget.getBoundingClientRect(); grab.current = Math.round(((e.clientY - r.top) / PX) / 15) * 15; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }}
                    onDragEnd={() => { dragging.current = null; setOver(null); }}
                    onClick={(e) => { e.stopPropagation(); onBlock(b, show); }}
                    aria-label={`${isBreak ? 'Break' : b.taskName}, ${fmtTime(c.start)} to ${fmtTime(c.end)}${b.status === 'suggested' ? ', suggested' : ''}${b.status === 'skipped' ? ', skipped' : ''}`}
                    className={cn('absolute z-[2] overflow-hidden rounded border px-1 py-0.5 text-left text-[11px] hover:shadow-card', draggable && 'cursor-grab active:cursor-grabbing',
                      isBreak ? 'border-olive bg-olive-soft text-olive-ink' : 'border-primary/50 bg-primary/10 text-ink', show === 'draft' && 'border-dashed', b.status === 'suggested' && 'opacity-70', b.status === 'skipped' && 'line-through opacity-50')}>
                    <span className="font-medium">{isBreak ? 'Break' : b.taskName}</span>{b.sessionCount > 1 && !isBreak && <span className="text-muted"> ({b.sessionIndex}/{b.sessionCount})</span>}<br />{minutesBetween(b.start, b.end)} min
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface MonthProps { data: CalendarData; anchor: string; show: 'draft' | 'active'; onOpenDay: (date: string) => void }
export function MonthGrid({ data, anchor, show, onOpenDay }: MonthProps) {
  const { from, to } = rangeFor('month', anchor); const days = daysIn(from, to); const [hover, setHover] = useState<string | null>(null);
  const blocks = show === 'draft' ? data.draftBlocks : data.approvedBlocks;
  return (
    <div role="region" aria-label="Month calendar" className="overflow-x-auto rounded-card border border-line bg-surface">
      <div className="grid min-w-[320px] grid-cols-7 text-xs">
        {[1, 2, 3, 4, 5, 6, 0].map((w) => <div key={w} className="border-b border-line bg-surface-2 px-1 py-1 text-center font-medium text-muted">{WEEKDAYS[w]}</div>)}
        {days.map((d) => {
          const info = data.days.find((x) => x.date === d); const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
          const appts = data.appointments.filter((a) => a.status === 'scheduled' && dateOf(a.startAt) === d); const planned = blocks.filter((b) => b.kind === 'task' && dateOf(b.start) === d && b.status !== 'skipped');
          const due = data.deadlines.filter((x) => x.dueDate === d && ['Pending', 'In Progress'].includes(x.status));
          return (
            <div key={d} className="relative" onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover((h) => (h === d ? null : h))}>
              <button type="button" onClick={() => onOpenDay(d)} onFocus={() => setHover(d)} onBlur={() => setHover((h) => (h === d ? null : h))} data-testid={`month-${d}`}
                aria-label={`${fmtDay(d)}: ${appts.length} appointments, ${planned.length} planned sessions, ${due.length} deadlines`}
                className={cn('flex h-20 w-full flex-col items-start gap-0.5 border-b border-l border-line p-1 text-left hover:bg-surface-2 sm:h-24', !inMonth && 'bg-surface-2/50 text-muted', info && !info.working && 'bg-surface-2/70', d === data.today && 'ring-2 ring-inset ring-primary')}>
                <span className={cn('text-xs font-medium', d === data.today && 'text-primary')}>{Number(d.slice(8))}</span>
                {appts.length > 0 && <span className="w-full truncate rounded bg-dusty-soft px-1 text-[10px] text-dusty-ink">{appts.length} appt{appts.length > 1 ? 's' : ''}</span>}
                {planned.length > 0 && <span className="w-full truncate rounded bg-primary/10 px-1 text-[10px]">{planned.length} task{planned.length > 1 ? 's' : ''}</span>}
                {due.length > 0 && <span className="w-full truncate rounded bg-terracotta-soft px-1 text-[10px] text-terracotta-ink">{due.length} due</span>}
              </button>
              {hover === d && <DayTooltip date={d} info={info} appts={appts} planned={planned} due={due} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayTooltip({ date, info, appts, planned, due }: { date: string; info?: CalendarData['days'][number]; appts: CalendarAppointment[]; planned: CalendarBlock[]; due: CalendarData['deadlines'] }) {
  const empty = !appts.length && !planned.length && !due.length;
  return (
    <div role="tooltip" className={cn('pointer-events-none absolute z-30 hidden w-56 rounded-lg border border-line bg-surface p-2 text-[11px] shadow-pop sm:block', weekday(date) === 0 || weekday(date) === 6 ? 'right-0' : 'left-0', 'top-full')}>
      <div className="mb-1 font-medium">{fmtDay(date)}{info && !info.working ? ' · day off' : ''}</div>
      {empty && <div className="text-muted">Nothing planned.</div>}
      {appts.slice(0, 3).map((a) => <div key={a.id} className="truncate">{fmtTime(a.startAt)} · {a.title}</div>)}
      {planned.slice(0, 3).map((b) => <div key={b.id} className="truncate text-muted">{fmtTime(b.start)} · {b.taskName}</div>)}
      {due.slice(0, 2).map((x) => <div key={x.taskId} className="truncate text-terracotta-ink">Due: {x.taskName}</div>)}
      {appts.length + planned.length + due.length > 8 && <div className="text-muted">…and more</div>}
      {info?.working && <div className="mt-1 text-muted">{fmtDuration(info.freeMinutes)} free · planned {fmtDuration(info.plannedMinutes)}{info.actualMinutes ? ` · worked ${fmtDuration(info.actualMinutes)}` : ''}</div>}
    </div>
  );
}
