import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2" aria-label="WorkToDo home">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-fg"><Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /></span>
      <span className="font-serif text-xl font-semibold text-ink">WorkToDo</span>
    </Link>
  );
}
