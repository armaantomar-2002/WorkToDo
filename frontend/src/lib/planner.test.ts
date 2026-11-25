import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysIn, dropToStart, fmtDuration, fmtTime, gridHours, layoutLanes, minutesBetween, monthEnd, rangeFor, shiftWall, snap, step, viewTitle, weekStart, weekday } from './planner';

describe('calendar date maths (zone independent)', () => {
  it('weeks start on Monday and ranges cover whole weeks', () => {
    expect(weekStart('2026-11-25')).toBe('2026-11-23'); expect(weekStart('2026-11-29')).toBe('2026-11-23'); expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(rangeFor('week', '2026-11-25')).toEqual({ from: '2026-11-23', to: '2026-11-29' }); expect(rangeFor('day', '2026-11-25')).toEqual({ from: '2026-11-25', to: '2026-11-25' });
  });
  it('month range spans full weeks and never exceeds the 43-day API limit', () => {
    const r = rangeFor('month', '2026-11-25'); expect(r).toEqual({ from: '2026-10-26', to: '2026-12-06' }); expect(daysIn(r.from, r.to)).toHaveLength(42);
    for (let m = 0; m < 24; m++) { const x = rangeFor('month', addMonths('2026-01-15', m)); expect(daysIn(x.from, x.to).length).toBeLessThanOrEqual(42); expect(weekday(x.from)).toBe(1); }
  });
  it('month stepping clamps the day and handles year ends and leap years', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'); expect(addMonths('2026-12-15', 1)).toBe('2027-01-15'); expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28'); expect(step('week', '2026-11-25', 1)).toBe('2026-12-02'); expect(step('day', '2026-12-31', 1)).toBe('2027-01-01');
  });
  it('wall-clock shifting crosses midnight without time zone effects', () => {
    expect(shiftWall('2026-11-25T23:30', 60)).toBe('2026-11-26T00:30'); expect(minutesBetween('2026-11-25T09:00', '2026-11-25T10:45')).toBe(105); expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });
  it('titles and formats', () => {
    expect(viewTitle('month', '2026-11-25')).toBe('Nov 2026'); expect(viewTitle('day', '2026-11-25')).toBe('Wed, 25 Nov 2026'); expect(fmtTime('2026-11-25T00:05')).toBe('12:05 AM'); expect(fmtTime('2026-11-25T13:30')).toBe('1:30 PM'); expect(fmtDuration(90)).toBe('1 h 30 min'); expect(fmtDuration(45)).toBe('45 min');
  });
});

describe('drag and drop maths', () => {
  it('snaps to 15 minutes and converts pointer position to a wall-clock start', () => {
    expect(snap(7)).toBe(0); expect(snap(8)).toBe(15); expect(snap(22)).toBe(15);
    expect(dropToStart('2026-11-25', 120, 1, 8 * 60)).toBe('2026-11-25T10:00'); expect(dropToStart('2026-11-25', 125, 1, 8 * 60)).toBe('2026-11-25T10:00');
    expect(dropToStart('2026-11-25', 130, 1, 8 * 60)).toBe('2026-11-25T10:15'); expect(dropToStart('2026-11-25', 120, 1, 8 * 60, 30)).toBe('2026-11-25T09:30');
    expect(dropToStart('2026-11-25', -500, 1, 8 * 60)).toBe('2026-11-25T00:00'); expect(dropToStart('2026-11-25', 9000, 1, 8 * 60)).toBe('2026-11-25T23:59');
  });
});

describe('overlap lanes', () => {
  const span = (x: { s: number; e: number }) => ({ start: x.s, end: x.e });
  it('separate items share one lane; overlaps get side-by-side lanes', () => {
    const p = layoutLanes([{ s: 0, e: 60 }, { s: 60, e: 120 }], span); expect(p.map((x) => [x.lane, x.lanes])).toEqual([[0, 1], [0, 1]]);
    const q = layoutLanes([{ s: 0, e: 120 }, { s: 30, e: 60 }, { s: 90, e: 150 }, { s: 200, e: 230 }], span); expect(q.map((x) => [x.lane, x.lanes])).toEqual([[0, 2], [1, 2], [1, 2], [0, 1]]);
  });
});

describe('grid hours', () => {
  it('uses the working window with padding and widens for early/late items', () => {
    expect(gridHours({ start: '09:00', end: '18:00' }, [])).toEqual({ startHour: 8, endHour: 19 });
    expect(gridHours({ start: '09:00', end: '18:00' }, [{ start: '2026-11-25T06:30', end: '2026-11-25T07:00' }, { start: '2026-11-25T20:00', end: '2026-11-25T21:30' }])).toEqual({ startHour: 5, endHour: 23 });
    expect(gridHours(null, [])).toEqual({ startHour: 7, endHour: 19 });
  });
});
