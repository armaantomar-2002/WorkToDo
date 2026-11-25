// Pure form validation for the planner (no React) so it can be unit-tested directly.
import { minutesBetween } from './planner';
import type { ConsequenceOfDelay, Importance } from './types';

export interface Form { title: string; location: string; description: string; startAt: string; endAt: string; prep: string; travel: string; importance: Importance; consequence: ConsequenceOfDelay }
export function validateAppointmentForm(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (!f.title.trim()) e.title = 'Enter a title'; else if (f.title.length > 120) e.title = 'Keep the title under 120 characters';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f.startAt)) e.startAt = 'Choose a start time';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f.endAt)) e.endAt = 'Choose an end time';
  if (!e.startAt && !e.endAt) { const m = minutesBetween(f.startAt, f.endAt); if (m <= 0) e.endAt = 'The end must be after the start'; else if (m > 1440) e.endAt = 'An appointment cannot be longer than 24 hours'; }
  for (const k of ['prep', 'travel'] as const) { const n = Number(f[k]); if (!Number.isInteger(n) || n < 0 || n > 480) e[k] = 'Enter 0 to 480 minutes'; }
  return e;
}


const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
export interface AvailabilityForm { start: string; end: string; days: number[]; breaksEnabled: boolean; breakMinutes: string; breakAfter: string; horizon: string }
export function validateAvailability(f: AvailabilityForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!hhmm.test(f.start)) e.start = 'Choose a start time';
  if (!(hhmm.test(f.end) || f.end === '24:00')) e.end = 'Choose an end time';
  if (!e.start && !e.end && f.end <= f.start) e.end = 'The working day must end after it starts';
  if (f.days.length === 0) e.days = 'Pick at least one working day';
  const int = (v: string, lo: number, hi: number) => /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi;
  if (!int(f.breakMinutes, 5, 60)) e.breakMinutes = 'Enter 5 to 60 minutes';
  if (!int(f.breakAfter, 30, 240)) e.breakAfter = 'Enter 30 to 240 minutes';
  if (!int(f.horizon, 1, 14)) e.horizon = 'Enter 1 to 14 days';
  return e;
}

