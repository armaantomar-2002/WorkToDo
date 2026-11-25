import { describe, expect, it } from 'vitest';
import { validateAppointmentForm, validateAvailability, type AvailabilityForm, type Form } from './plannerForms';

const appt = (o: Partial<Form> = {}): Form => ({ title: 'Doctor', location: '', description: '', startAt: '2026-11-25T11:00', endAt: '2026-11-25T12:00', prep: '0', travel: '0', importance: 'Medium', consequence: 'Moderate', ...o });
const avail = (o: Partial<AvailabilityForm> = {}): AvailabilityForm => ({ start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], breaksEnabled: true, breakMinutes: '10', breakAfter: '90', horizon: '7', ...o });

describe('appointment form validation', () => {
  it('accepts a valid appointment', () => expect(validateAppointmentForm(appt())).toEqual({}));
  it('requires a title and a sensible time range', () => {
    expect(validateAppointmentForm(appt({ title: '  ' })).title).toBeTruthy();
    expect(validateAppointmentForm(appt({ endAt: '2026-11-25T11:00' })).endAt).toMatch(/after the start/);
    expect(validateAppointmentForm(appt({ endAt: '2026-11-25T10:00' })).endAt).toBeTruthy();
    expect(validateAppointmentForm(appt({ endAt: '2026-11-26T12:00' })).endAt).toMatch(/24 hours/);
    expect(validateAppointmentForm(appt({ startAt: '' })).startAt).toBeTruthy();
  });
  it('limits buffers to whole minutes 0-480', () => {
    expect(validateAppointmentForm(appt({ prep: '481' })).prep).toBeTruthy(); expect(validateAppointmentForm(appt({ travel: '-5' })).travel).toBeTruthy(); expect(validateAppointmentForm(appt({ travel: '2.5' })).travel).toBeTruthy(); expect(validateAppointmentForm(appt({ prep: '480', travel: '0' }))).toEqual({});
  });
});
describe('availability validation', () => {
  it('accepts defaults and a 24:00 end', () => { expect(validateAvailability(avail())).toEqual({}); expect(validateAvailability(avail({ end: '24:00' }))).toEqual({}); });
  it('rejects an end before the start, no working days and out-of-range numbers', () => {
    expect(validateAvailability(avail({ end: '08:00' })).end).toBeTruthy(); expect(validateAvailability(avail({ days: [] })).days).toBeTruthy();
    expect(validateAvailability(avail({ breakMinutes: '3' })).breakMinutes).toBeTruthy(); expect(validateAvailability(avail({ breakAfter: '500' })).breakAfter).toBeTruthy(); expect(validateAvailability(avail({ horizon: '0' })).horizon).toBeTruthy(); expect(validateAvailability(avail({ horizon: '15' })).horizon).toBeTruthy();
  });
});
