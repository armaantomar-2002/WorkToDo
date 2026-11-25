import { describe, expect, it } from 'vitest';
import { clockParts, dateKeyInZone, safeZone } from './clock';

describe('clock / local date', () => {
  it('Asia/Kolkata crosses midnight at 18:30 UTC (the reported 24 Nov vs 25 Nov bug)', () => {
    expect(dateKeyInZone(new Date('2026-11-24T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-11-24');
    expect(dateKeyInZone(new Date('2026-11-24T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-11-25');
    expect(dateKeyInZone(new Date('2026-11-24T18:30:00Z'), 'UTC')).toBe('2026-11-24'); // what a UTC default would wrongly show
  });
  it('formats h:m:s, date and zone in the chosen zone', () => {
    const p = clockParts(new Date('2026-11-24T21:49:07Z'), 'Asia/Kolkata');
    expect(p.time).toBe('03:19:07'); expect(p.date).toContain('25'); expect(p.date).toContain('Nov'); expect(p.dateKey).toBe('2026-11-25'); expect(p.zone).toMatch(/GMT\+5:30|IST/);
  });
  it('midnight renders 00:xx:xx, never 24:xx', () => { expect(clockParts(new Date('2026-11-24T18:30:05Z'), 'Asia/Kolkata').time).toBe('00:00:05'); });
  it('falls back safely for invalid or empty zones', () => { expect(safeZone('Not/AZone')).toBe('Asia/Kolkata'); expect(safeZone(null)).toBe('Asia/Kolkata'); expect(safeZone('America/New_York')).toBe('America/New_York'); });
});
