import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, CalendarDays, ClipboardList, Clock, LayoutDashboard, Menu, Settings, Sparkles, X, type LucideIcon } from 'lucide-react';
import { Logo } from './Logo';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../api/hooks';
import { LiveClock } from './LiveClock';
import { TimeZoneNotice } from './TimeZoneNotice';
import { useTheme } from '../../theme/ThemeProvider';
import { cn } from '../../lib/cn';
import { initials } from '../../lib/format';

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tasks', label: 'My Tasks', icon: ClipboardList },
  { to: '/planner', label: 'Planner', icon: CalendarDays },
  { to: '/recommendations', label: 'Recommendations', icon: Sparkles },
  { to: '/sessions', label: 'Focus Sessions', icon: Clock },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-6"><Logo to="/dashboard" /></div>
      <nav aria-label="Main" className="flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-primary text-primary-fg' : 'text-ink hover:bg-surface-2')}>
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />{label}
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center gap-3 border-t border-line px-5 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-olive-soft font-semibold text-olive-ink" aria-hidden="true">{initials(user?.fullName ?? '')}</span>
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{user?.fullName}</p><p className="truncate text-xs text-muted">{user?.email}</p></div>
      </div>
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { setTheme } = useTheme();
  const prefs = usePreferences();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => { if (prefs.data) setTheme(prefs.data.themePreference); }, [prefs.data, setTheme]);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface-2/60 lg:block"><SidebarContent /></aside>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-page/95 px-4 py-3 backdrop-blur lg:hidden">
        <Logo to="/dashboard" />
        <div className="ml-auto mr-3 min-w-0"><LiveClock compact /></div>
        <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation menu" className="rounded-lg border border-line p-2"><Menu className="h-5 w-5" /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-surface shadow-pop">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation menu" className="absolute right-3 top-4 rounded p-1"><X className="h-5 w-5" /></button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="min-w-0">
        <div className="sticky top-0 z-20 hidden justify-end border-b border-line bg-page/95 px-8 py-2 backdrop-blur lg:flex"><LiveClock /></div>
        <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-9"><div className="mx-auto max-w-6xl"><TimeZoneNotice /><Outlet /></div></main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-3xl font-semibold">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
