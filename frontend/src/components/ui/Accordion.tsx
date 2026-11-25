import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

export function Accordion({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="card">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-5 py-4 text-left">
        <span className="font-serif text-lg font-semibold">{title}</span>
        <ChevronDown aria-hidden="true" className={cn('h-5 w-5 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div id={id} className="border-t border-line px-5 py-4">{children}</div>}
    </div>
  );
}
