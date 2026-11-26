import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ScheduleTimeline } from './ScheduleTimeline';
import { formatTimeRange } from '../../lib/format';
import type { ScheduleView, TimelineItem } from '../../lib/types';

const item = (o: Partial<TimelineItem>): TimelineItem => ({ key: o.title ?? 'x', kind: 'task', blockId: 'b', taskId: 't', appointmentId: null, title: 'T', start: '2026-11-26T11:22', end: '2026-11-26T11:37', durationMinutes: 15, sessionIndex: 1, sessionCount: 1, status: 'planned', source: 'engine', reason: null, warnings: [], prerequisites: [], ...o });
const view = (timeline: TimelineItem[]): ScheduleView => ({ timeline, infeasibilities: [], unscheduled: [], schedule: { id: 's1', versionNumber: 1 } } as unknown as ScheduleView);

describe('time intervals', () => {
  it('formats exact wall-clock intervals without timezone shifts', () => {
    expect(formatTimeRange('2026-11-26T11:22', '2026-11-26T11:37')).toBe('11:22 AM – 11:37 AM');
    expect(formatTimeRange('2026-11-26T13:00', '2026-11-26T15:00')).toBe('1:00 PM – 3:00 PM');
    expect(formatTimeRange('2026-11-26T23:30', '2026-11-27T00:30')).toBe('11:30 PM – 12:30 AM (Nov 27, 2026)');
  });
});
describe('ScheduleTimeline', () => {
  it('shows every item with its interval, in the given order, and no score', () => {
    renderWithProviders(<ScheduleTimeline view={view([item({ title: 'Reply to manager' }), item({ title: 'Dentist Appointment', kind: 'fixed', start: '2026-11-26T13:00', end: '2026-11-26T15:00', durationMinutes: 120 }), item({ title: 'Study', start: '2026-11-26T15:00', end: '2026-11-26T16:00', durationMinutes: 60, sessionCount: 2 })])} />);
    const rows = screen.getAllByTestId('timeline-item'); expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('11:22 AM – 11:37 AM'); expect(rows[1]).toHaveTextContent('1:00 PM – 3:00 PM'); expect(rows[1]).toHaveTextContent('Fixed appointment'); expect(rows[2]).toHaveTextContent('Session 1 of 2');
    expect(screen.queryByText(/Score/)).toBeNull();
  });
  it('explains an infeasible schedule and labels unscheduled tasks', () => {
    const v = { ...view([]), infeasibilities: [{ code: 'infeasible_before_fixed', constraint: { kind: 'fixed', label: 'x', at: '2026-11-26T16:30' }, requiredMinutes: 300, availableMinutes: 240, shortfallMinutes: 60, tasks: [{ taskId: 'a', taskName: 'Dev', remainingMinutes: 300, scheduled: false }], message: 'Your remaining prerequisite work requires 5 hours, but only 4 hours are available. Your current schedule is not feasible.', alternatives: ['Move non-critical tasks.'] }], unscheduled: [{ taskId: 'a', taskName: 'Dev', remainingMinutes: 300, scheduledMinutes: 0, code: 'x', message: 'No time before the demo.' }] } as unknown as ScheduleView;
    renderWithProviders(<ScheduleTimeline view={v} />);
    expect(screen.getByTestId('infeasible')).toHaveTextContent('requires 5 hours, but only 4 hours'); expect(screen.getByTestId('unscheduled')).toHaveTextContent('Unscheduled');
  });
});
