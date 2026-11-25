import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { Category, Importance, TaskStatus } from '../../lib/types';

export type Tone = 'terracotta' | 'dusty' | 'amber' | 'olive' | 'neutral';
const TONES: Record<Tone, string> = {
  terracotta: 'bg-terracotta-soft text-terracotta-ink', dusty: 'bg-dusty-soft text-dusty-ink', amber: 'bg-amber-soft text-amber-ink',
  olive: 'bg-olive-soft text-olive-ink', neutral: 'bg-surface-2 text-muted',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone], className)}>{children}</span>;
}

// Critical = terracotta, High = amber, Medium = olive-neutral, Low = dusty blue (as in the approved design).
const IMPORTANCE_TONE: Record<Importance, Tone> = { Critical: 'terracotta', High: 'amber', Medium: 'olive', Low: 'dusty' };
const STATUS_TONE: Record<TaskStatus, Tone> = { Pending: 'amber', 'In Progress': 'dusty', Completed: 'olive', Cancelled: 'neutral' };
const CATEGORY_TONE: Record<Category, Tone> = { 'Do now': 'terracotta', 'Do next': 'amber', 'Schedule later': 'dusty' };
export const ImportanceBadge = ({ value }: { value: Importance }) => <Badge tone={IMPORTANCE_TONE[value]}>{value}</Badge>;
export const StatusBadge = ({ value }: { value: TaskStatus }) => <Badge tone={STATUS_TONE[value]}>{value}</Badge>;
export const CategoryBadge = ({ value }: { value: Category }) => <Badge tone={CATEGORY_TONE[value]}>{value}</Badge>;
