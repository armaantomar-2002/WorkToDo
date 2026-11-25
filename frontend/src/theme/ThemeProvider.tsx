import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Theme } from '../lib/types';

const KEY = 'wt-theme'; // a UI convenience only (no personal data); the saved preference in the database wins after login
interface ThemeValue { theme: Theme; setTheme: (t: Theme) => void }
const Ctx = createContext<ThemeValue | null>(null);

function initial(): Theme {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v; } catch { /* storage unavailable */ }
  return 'light';
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initial);
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  const setTheme = useCallback((t: Theme) => { setThemeState(t); try { localStorage.setItem(KEY, t); } catch { /* ignore */ } }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useTheme(): ThemeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>');
  return v;
}

/** Reads the chart palette from the active theme's CSS variables (SVG attributes cannot use var()). */
export function useChartColors() {
  const { theme } = useTheme();
  return useMemo(() => {
    const read = (name: string) => { const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().split(/\s+/).join(','); return raw ? `rgb(${raw})` : '#888'; };
    return { olive: read('olive'), terracotta: read('terracotta'), dusty: read('dusty'), amber: read('amber'), line: read('line'), muted: read('muted'), ink: read('ink'), surface: read('surface') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}
