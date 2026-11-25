import { cn } from '../../lib/cn';

/** Client-side hint only. The backend enforces the real policy (8-128 chars, a letter and a number). */
export function passwordScore(pw: string): { score: number; label: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) && /[A-Z]/.test(pw)) s++;
  return { score: s, label: ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][s] };
}
export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const { score, label } = passwordScore(password);
  return (
    <div aria-live="polite" className="space-y-1">
      <div className="flex gap-1">{[1, 2, 3, 4].map((i) => <span key={i} className={cn('h-1.5 flex-1 rounded-full', i <= score ? (score <= 1 ? 'bg-terracotta' : score === 2 ? 'bg-amber' : 'bg-olive') : 'bg-line')} />)}</div>
      <p className="text-xs text-muted">Password strength: {label}. Use at least 8 characters with a letter and a number.</p>
    </div>
  );
}
