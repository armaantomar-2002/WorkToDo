import { cn } from '../../lib/cn';

export interface TabItem<T extends string> { value: T; label: string; count?: number }
/** Pill tabs (active = charcoal), as in the approved design. */
export function PillTabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cn('rounded-full border px-4 py-1.5 text-sm font-medium transition', value === t.value ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-ink hover:bg-surface-2')}>
          {t.label}{t.count !== undefined && <span className="ml-1 opacity-80">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}
