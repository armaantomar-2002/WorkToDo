import { useEffect, useId, useState } from 'react';
import { DURATION_PRESETS, describeMinutes, parseDuration, splitMinutes } from '../../lib/duration';

interface Props { id: string; value: number | null; onChange: (minutes: number | null) => void; invalid?: boolean; disabled?: boolean; presets?: boolean }

/** Hours + minutes boxes with quick presets. Emits TOTAL MINUTES (or null while empty/invalid). Touch-friendly: 44px targets, wraps on narrow screens. */
export function DurationInput({ id, value, onChange, invalid, disabled, presets = true }: Props) {
  const init = splitMinutes(value);
  const [h, setH] = useState(init ? String(init.hours) : '');
  const [m, setM] = useState(init ? String(init.minutes) : '');
  const localError = parseDuration(h, m).error;
  const hint = useId();

  // Follow external changes (form reset, preset click) without fighting the user's typing.
  useEffect(() => {
    if (parseDuration(h, m).total !== value) { const s = splitMinutes(value); setH(s ? String(s.hours) : ''); setM(s ? String(s.minutes) : ''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (nh: string, nm: string) => { setH(nh); setM(nm); onChange(parseDuration(nh, nm).total); };
  const box = 'h-11 w-20 rounded-lg border bg-surface px-3 text-center text-sm focus:outline-none focus:ring-2 focus:ring-olive';
  const border = invalid || localError ? 'border-red-500' : 'border-line';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-describedby={hint}>
        <label className="flex items-center gap-1 text-sm"><input id={id} type="number" inputMode="numeric" min={0} step={1} disabled={disabled} aria-label="Hours" aria-invalid={!!(invalid || localError)} className={`${box} ${border}`} value={h} onChange={(e) => emit(e.target.value, m)} />hours</label>
        <label className="flex items-center gap-1 text-sm"><input id={`${id}-minutes`} type="number" inputMode="numeric" min={0} max={59} step={1} disabled={disabled} aria-label="Minutes" aria-invalid={!!(invalid || localError)} className={`${box} ${border}`} value={m} onChange={(e) => emit(h, e.target.value)} />minutes</label>
        <span id={hint} className="text-sm text-muted" data-testid={`${id}-total`}>{value ? `= ${describeMinutes(value)}` : ''}</span>
      </div>
      {localError && <p role="alert" className="text-xs text-red-600">{localError}</p>}
      {presets && (
        <div className="flex flex-wrap gap-2" aria-label="Quick durations">
          {DURATION_PRESETS.map((p) => (
            <button key={p.minutes} type="button" disabled={disabled} onClick={() => { const s = splitMinutes(p.minutes)!; emit(String(s.hours), String(s.minutes)); }}
              aria-pressed={value === p.minutes}
              className={`min-h-9 rounded-full border px-3 text-xs ${value === p.minutes ? 'border-olive bg-olive/10 font-medium' : 'border-line hover:bg-surface-2'}`}>{p.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
