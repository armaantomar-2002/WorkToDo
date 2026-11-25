import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { clockParts, deviceZone, safeZone } from '../../lib/clock';
import { usePreferences } from '../../api/hooks';

/** Permanent live clock: updates every second in the user's configured zone (default Asia/Kolkata). Compact variant for the mobile header. */
export function LiveClock({ compact = false }: { compact?: boolean }) {
  const prefs = usePreferences();
  const zone = safeZone(prefs.data?.timeZone);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const p = clockParts(now, zone);
  const mismatch = deviceZone() !== zone;
  const title = `${zone}${mismatch ? ` — your device is set to ${deviceZone()}. Change the time zone in Settings if this is wrong.` : ''}`;
  return (
    <div className={`flex items-center gap-2 text-right ${compact ? 'text-xs' : 'text-sm'}`} role="timer" aria-label={`Current time ${p.time} ${p.date} ${p.zone}`} title={title} data-testid="live-clock">
      {!compact && <Clock className="h-4 w-4 text-muted" aria-hidden="true" />}
      <div className="leading-tight">
        <div className="font-semibold tabular-nums">{p.time}</div>
        <div className="text-[11px] text-muted">{compact ? p.date.replace(/ \d{4}$/, '') : p.date} · {p.zone}{mismatch && <span aria-hidden="true"> ⚠</span>}</div>
      </div>
    </div>
  );
}
