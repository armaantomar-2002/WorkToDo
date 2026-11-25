import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('card', className)} {...rest} />; }
export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={cn('flex items-center justify-between gap-3 px-5 pt-5', className)}><h2 className="text-lg font-semibold">{title}</h2>{action}</div>;
}

const ICON_TONES = { terracotta: 'text-terracotta', olive: 'text-olive', dusty: 'text-dusty', amber: 'text-amber' } as const;
export function StatCard({ icon: Icon, value, label, tone = 'olive' }: { icon: LucideIcon; value: ReactNode; label: string; tone?: keyof typeof ICON_TONES }) {
  return (
    <Card className="flex flex-col items-center gap-1 px-4 py-5 text-center">
      <div className="flex items-center gap-2"><Icon aria-hidden="true" className={cn('h-6 w-6', ICON_TONES[tone])} /><span className="font-serif text-3xl font-semibold leading-none" data-testid={`stat-${label}`}>{value}</span></div>
      <span className="text-xs text-muted">{label}</span>
    </Card>
  );
}
