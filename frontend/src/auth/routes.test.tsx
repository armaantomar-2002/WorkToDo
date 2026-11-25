import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute } from './Routes';

const auth = vi.hoisted(() => ({ status: 'anonymous' as 'loading' | 'anonymous' | 'authenticated' }));
vi.mock('./AuthContext', () => ({ useAuth: () => ({ status: auth.status }) }));

function app(start: string) {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route element={<PublicOnlyRoute />}><Route path="/login" element={<p>login page</p>} /></Route>
        <Route element={<ProtectedRoute />}><Route path="/dashboard" element={<p>dashboard page</p>} /><Route path="/sessions" element={<p>sessions page</p>} /></Route>
        <Route path="/" element={<p>landing</p>} />
      </Routes>
    </MemoryRouter>);
}

describe('route guards', () => {
  it('anonymous visitors are redirected from every protected page to /login', () => {
    auth.status = 'anonymous'; app('/sessions'); expect(screen.getByText('login page')).toBeInTheDocument(); expect(screen.queryByText('sessions page')).toBeNull();
  });
  it('authenticated users reach protected pages and are bounced away from /login', () => {
    auth.status = 'authenticated'; const { unmount } = app('/dashboard'); expect(screen.getByText('dashboard page')).toBeInTheDocument(); unmount();
    app('/login'); expect(screen.getByText('dashboard page')).toBeInTheDocument();
  });
  it('while the session is being restored nothing protected is rendered and nobody is redirected', () => {
    auth.status = 'loading'; app('/dashboard'); expect(screen.queryByText('dashboard page')).toBeNull(); expect(screen.queryByText('login page')).toBeNull();
  });
  it('the public landing page is reachable without authentication', () => { auth.status = 'anonymous'; app('/'); expect(screen.getByText('landing')).toBeInTheDocument(); });
});
