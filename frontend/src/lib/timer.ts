import type { FocusTimer } from './types';

/**
 * Seconds of focused time to DISPLAY. The server computes `elapsedSeconds` at fetch time from its own timestamps; between fetches the
 * browser only adds the wall-clock delta while the timer is running (a paused/ended timer never advances). Because this is a delta
 * from the fetch instant, a refresh, a throttled background tab or a wrong local clock offset cannot corrupt the value; the next
 * fetch (every 30 s, on focus and on reconnect) re-syncs it.
 */
export function displayElapsed(timer: Pick<FocusTimer, 'status' | 'elapsedSeconds'>, fetchedAtMs: number, nowMs: number): number {
  if (timer.status !== 'running') return timer.elapsedSeconds;
  return timer.elapsedSeconds + Math.max(0, Math.floor((nowMs - fetchedAtMs) / 1000));
}

export function splitRemaining(plannedSeconds: number, elapsed: number): { remaining: number; overtime: number } {
  return { remaining: Math.max(0, plannedSeconds - elapsed), overtime: Math.max(0, elapsed - plannedSeconds) };
}

/** 3725 -> "1:02:05", 125 -> "2:05" */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Compact duration for history rows: 45 -> "45 sec", 125 -> "2 min", 3725 -> "1 hr 2 min". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null) return '—';
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
}
