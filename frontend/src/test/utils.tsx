import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui';
import { ThemeProvider } from '../theme/ThemeProvider';

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<ThemeProvider><QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><ToastProvider>{ui}</ToastProvider></MemoryRouter></QueryClientProvider></ThemeProvider>);
}
