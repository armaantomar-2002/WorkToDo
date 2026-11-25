import { describe, expect, it } from 'vitest';
import { displayElapsed, formatClock, formatDuration, splitRemaining } from './timer';

describe('timer display maths', () => {
  const base = { status: 'running' as const, elapsedSeconds: 300 };
  it('a running timer advances by the wall-clock delta since the server snapshot', () => {
    expect(displayElapsed(base, 1_000_000, 1_000_000)).toBe(300);
    expect(displayElapsed(base, 1_000_000, 1_042_900)).toBe(342); // 42.9 s -> 42 whole seconds
  });
  it('a refresh / throttled tab cannot lose time: the value is recomputed from the snapshot, not counted by ticks', () => {
    expect(displayElapsed(base, 0, 600_000)).toBe(900);
  });
  it('paused and ended timers never advance', () => {
    expect(displayElapsed({ status: 'paused', elapsedSeconds: 300 }, 0, 9_999_999)).toBe(300);
    expect(displayElapsed({ status: 'finished', elapsedSeconds: 300 }, 0, 9_999_999)).toBe(300);
  });
  it('clock skew (now before the snapshot) never produces negative time', () => { expect(displayElapsed(base, 5_000, 1_000)).toBe(300); });
  it('remaining vs overtime are separate', () => {
    expect(splitRemaining(1500, 600)).toEqual({ remaining: 900, overtime: 0 });
    expect(splitRemaining(1500, 1500)).toEqual({ remaining: 0, overtime: 0 });
    expect(splitRemaining(1500, 1620)).toEqual({ remaining: 0, overtime: 120 });
  });
  it('formats clocks and durations', () => {
    expect(formatClock(0)).toBe('0:00'); expect(formatClock(125)).toBe('2:05'); expect(formatClock(3725)).toBe('1:02:05'); expect(formatClock(-4)).toBe('0:00');
    expect(formatDuration(null)).toBe('—'); expect(formatDuration(45)).toBe('45 sec'); expect(formatDuration(125)).toBe('2 min'); expect(formatDuration(3725)).toBe('1 hr 2 min'); expect(formatDuration(3600)).toBe('1 hr');
  });
});
