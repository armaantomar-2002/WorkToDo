import { describe, expect, it } from 'vitest';
import { describeMinutes, parseDuration, splitMinutes } from './duration';

describe('duration helpers', () => {
  it('converts the spec examples to total minutes', () => {
    expect(parseDuration('0', '30').total).toBe(30);
    expect(parseDuration('1', '30').total).toBe(90);
    expect(parseDuration('2', '0').total).toBe(120);
    expect(parseDuration('3', '15').total).toBe(195);
    expect(parseDuration('', '45').total).toBe(45);
    expect(parseDuration('2', '').total).toBe(120);
  });
  it('validates hours, minutes and zero totals', () => {
    expect(parseDuration('-1', '0').error).toMatch(/negative/);
    expect(parseDuration('0', '60').error).toMatch(/0 and 59/);
    expect(parseDuration('0', '-5').error).toMatch(/0 and 59/);
    expect(parseDuration('0', '0').error).toMatch(/greater than zero/);
    expect(parseDuration('1.5', '0').error).toMatch(/whole/);
    expect(parseDuration('169', '0').error).toMatch(/7 days/);
    expect(parseDuration('', '')).toEqual({ total: null, error: null });
  });
  it('splits and describes durations readably', () => {
    expect(splitMinutes(195)).toEqual({ hours: 3, minutes: 15 });
    expect(splitMinutes(null)).toBeNull();
    expect([30, 60, 90, 120, 195, 1].map(describeMinutes)).toEqual(['30 minutes', '1 hour', '1 hour 30 minutes', '2 hours', '3 hours 15 minutes', '1 minute']);
  });
});
