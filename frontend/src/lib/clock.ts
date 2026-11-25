/** Live-clock and "which calendar day is it for the user" helpers. Pure (inject `now`) so they are testable around midnight. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

export function safeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIME_ZONE;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return DEFAULT_TIME_ZONE; }
}

export const deviceZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE; } catch { return DEFAULT_TIME_ZONE; } };

export interface ClockParts { time: string; date: string; zone: string; dateKey: string }

export function clockParts(now: Date, tz: string): ClockParts {
  const zone = safeZone(tz);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(now);
  const zoneName = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'short' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? zone;
  return { time, date, zone: zoneName, dateKey: dateKeyInZone(now, zone) };
}

/** YYYY-MM-DD of the instant in the zone (en-CA formats as ISO). */
export function dateKeyInZone(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: safeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
