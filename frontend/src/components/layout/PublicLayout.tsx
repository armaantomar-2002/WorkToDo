import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from './Logo';
import { PersonLaptop } from '../illustrations/Illustrations';

/** Split layout for register/login/forgot/reset: illustration + form card, as in the approved design. */
export function AuthLayout({ title, subtitle, children, variant = 'a', footer }: { title: string; subtitle: string; children: ReactNode; variant?: 'a' | 'b'; footer?: ReactNode }) {
  return (
    <div className="min-h-screen">
      <div className="px-6 py-5"><Logo /></div>
      <main className="mx-auto grid max-w-5xl items-center gap-6 px-4 pb-16 md:grid-cols-[1fr_minmax(0,28rem)]">
        <div className="hidden md:block"><PersonLaptop variant={variant} className="mx-auto w-full max-w-sm" /></div>
        <section className="card p-7 sm:p-8" aria-labelledby="auth-title">
          <h1 id="auth-title" className="text-3xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
          {footer && <p className="mt-6 text-center text-sm">{footer}</p>}
        </section>
      </main>
    </div>
  );
}
export const AuthLink = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to} className="font-semibold text-terracotta hover:underline">{children}</Link>;
