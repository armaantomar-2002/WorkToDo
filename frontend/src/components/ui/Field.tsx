import { forwardRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown, Eye, EyeOff, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

interface FormFieldProps { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode; className?: string }
export function FormField({ label, htmlFor, error, hint, children, className }: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">{label}</label>
      {children}
      {hint && !error && <p id={`${htmlFor}-hint`} className="text-xs text-muted">{hint}</p>}
      {error && <p id={`${htmlFor}-error`} role="alert" className="text-xs font-medium text-terracotta">{error}</p>}
    </div>
  );
}

const describedBy = (id?: string, error?: boolean, hint?: boolean) => [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;

interface InputProps extends InputHTMLAttributes<HTMLInputElement> { invalid?: boolean; icon?: LucideIcon; hasHint?: boolean }
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, icon: Icon, className, hasHint, ...rest }, ref) {
  const input = <input ref={ref} aria-invalid={invalid || undefined} aria-describedby={describedBy(rest.id, invalid, hasHint)} className={cn('field-input', Icon && 'pl-10', className)} {...rest} />;
  if (!Icon) return input;
  return <div className="relative"><Icon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />{input}</div>;
});

export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(function PasswordInput({ invalid, icon: Icon, className, hasHint, ...rest }, ref) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      {Icon && <Icon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />}
      <input ref={ref} type={shown ? 'text' : 'password'} aria-invalid={invalid || undefined} aria-describedby={describedBy(rest.id, invalid, hasHint)} className={cn('field-input pr-10', Icon && 'pl-10', className)} {...rest} />
      <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink">
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { invalid?: boolean; hasHint?: boolean }
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ invalid, className, children, hasHint, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} aria-invalid={invalid || undefined} aria-describedby={describedBy(rest.id, invalid, hasHint)} className={cn('field-input appearance-none pr-9', className)} {...rest}>{children}</select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ invalid, className, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn('field-input min-h-[84px] resize-y', className)} {...rest} />;
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string }>(function Checkbox({ label, className, id, ...rest }, ref) {
  return (
    <label htmlFor={id} className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-ink', className)}>
      <input ref={ref} id={id} type="checkbox" className="h-4 w-4 rounded border-line accent-[rgb(var(--primary))]" {...rest} />
      {label}
    </label>
  );
});
