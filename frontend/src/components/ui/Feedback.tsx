import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, type LucideIcon } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/cn';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /><span>{label}…</span></div>;
}
export function Skeleton({ className }: { className?: string }) { return <div aria-hidden="true" className={cn('animate-pulse rounded-lg bg-surface-2', className)} />; }

export function EmptyState({ icon: Icon = Info, title, message, action }: { icon?: LucideIcon; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Icon aria-hidden="true" className="h-9 w-9 text-muted/70" />
      <h3 className="font-serif text-lg font-semibold">{title}</h3>
      {message && <p className="max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export function ErrorState({ message, onRetry, title = 'Something went wrong' }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <AlertCircle aria-hidden="true" className="h-9 w-9 text-terracotta" />
      <h3 className="font-serif text-lg font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
const ALERTS = { error: ['bg-terracotta-soft text-terracotta-ink', AlertCircle], success: ['bg-olive-soft text-olive-ink', CheckCircle2], info: ['bg-dusty-soft text-dusty-ink', Info], warning: ['bg-amber-soft text-amber-ink', AlertCircle] } as const;
export function Alert({ tone = 'info', children, className }: { tone?: keyof typeof ALERTS; children: ReactNode; className?: string }) {
  const [style, Icon] = ALERTS[tone];
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm', style, className)}><Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div></div>;
}
