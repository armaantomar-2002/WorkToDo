import { describe, expect, it } from 'vitest';
import { daysBetween, dueLabel, formatDate, formatDateTime, formatMinutes, fromInputDateTime, greeting, initials, periodForHour, toInputDateTime } from './format';

describe('format helpers', () => {
  it('formats dates without any timezone shift', () => {
    expect(formatDate('2026-11-16')).toBe('Nov 16, 2026'); expect(formatDate(null)).toBe('—'); expect(formatDate('2026-01-01T00:00:00.000Z')).toBe('Jan 1, 2026');
    expect(formatDateTime('2026-11-16 10:00:00')).toBe('Nov 16, 2026, 10:00 AM'); expect(formatDateTime('2026-11-16 00:05:00')).toBe('Nov 16, 2026, 12:05 AM'); expect(formatDateTime('2026-11-16T13:30')).toBe('Nov 16, 2026, 1:30 PM');
  });
  it('formats minutes', () => { expect(formatMinutes(30)).toBe('30 min'); expect(formatMinutes(60)).toBe('1 hr'); expect(formatMinutes(135)).toBe('2 hr 15 min'); expect(formatMinutes(null)).toBe('—'); });
  it('computes due labels by calendar days', () => {
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(dueLabel('2026-11-25', '2026-11-24')).toBe('Due in 1 day'); expect(dueLabel('2026-11-24', '2026-11-24')).toBe('Due today'); expect(dueLabel('2026-11-30', '2026-11-24')).toBe('Due in 6 days');
    expect(dueLabel('2026-11-23', '2026-11-24')).toBe('Overdue by 1 day'); expect(dueLabel('2026-11-20', '2026-11-24')).toBe('Overdue by 4 days'); expect(dueLabel(null, '2026-11-24')).toBe('No deadline');
  });
  it('converts datetime-local values to the API wall-clock format and back', () => {
    expect(fromInputDateTime('2026-11-16T10:00')).toBe('2026-11-16 10:00:00'); expect(toInputDateTime('2026-11-16 10:00:00')).toBe('2026-11-16T10:00');
  });
  it('misc', () => { expect(initials('Armaan Singh')).toBe('AS'); expect(initials('')).toBe('?'); expect(periodForHour(9)).toBe('Morning'); expect(periodForHour(14)).toBe('Afternoon'); expect(periodForHour(19)).toBe('Evening'); expect(periodForHour(2)).toBe('Night'); expect(greeting(8)).toBe('Good morning'); });
});
