import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';

const auth = vi.hoisted(() => ({
  mounts: vi.fn(),
  providerProps: [] as Array<Record<string, unknown>>,
  isLoaded: true,
  signIn: vi.fn(),
}));
vi.mock('@clerk/react', () => ({
  ClerkProvider: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => {
    auth.providerProps.push(props);
    useEffect(() => {
      auth.mounts();
    }, []);
    return <>{children}</>;
  },
  useAuth: () => ({ isLoaded: auth.isLoaded, userId: null }),
  useUser: () => ({ user: null }),
  SignIn: (props: Record<string, unknown>) => {
    auth.signIn(props);
    return <div data-testid="admin-prebuilt-sign-in">Administrator authentication</div>;
  },
}));
vi.mock('@clerk/react/internal', () => ({ publishableKeyFromHost: () => 'test-publishable-key' }));
vi.mock('@/pages/passenger', () => ({
  default: ({ experience }: { experience: string }) => <h1>{experience} passenger page</h1>,
}));
vi.mock('@/pages/operator', () => ({ default: () => <h1>Driver console</h1> }));
vi.mock('@/components/driver-login-form', () => ({
  DriverLoginForm: () => <h2>Driver login</h2>,
}));
vi.mock('@/pages/driver-sign-up', () => ({ default: () => <h1>Assigned driver accounts</h1> }));
vi.mock('@/pages/passenger-layout-fixture', () => ({ default: () => null }));
vi.mock('@/pages/navigation-layout-fixture', () => ({ default: () => null }));
vi.mock('@/providers/live-trip', () => ({ clearOperatorSession: vi.fn() }));
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }));

import App from './App';

describe('public pages are outside driver authentication', () => {
  beforeEach(() => {
    auth.mounts.mockClear();
    auth.signIn.mockClear();
    auth.isLoaded = true;
    auth.providerProps.length = 0;
    localStorage.clear();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it.each([
    ['/passengers', 'personal'],
    ['/bus-display', 'mounted'],
    ['/', 'personal'],
    ['/mounted?join=old-invitation&fullscreen=1', 'mounted'],
    ['/coach-display/mounted', 'mounted'],
  ])('opens %s without initializing Clerk', async (path, experience) => {
    window.history.replaceState({}, '', path);
    render(<App />);
    await screen.findByRole('heading', { name: `${experience} passenger page` });
    expect(auth.mounts).not.toHaveBeenCalled();
    if (path.includes('join=')) {
      expect(window.location.pathname).toBe('/bus-display');
      expect(window.location.search).toContain('join=old-invitation');
      expect(window.location.search).toContain('fullscreen=1');
    }
  });

  it.each(['/drivers', '/operator'])('requires sign-in at %s', async (path) => {
    window.history.replaceState({}, '', path);
    render(<App />);
    await screen.findByRole('heading', { name: 'Driver login' });
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'));
    expect(auth.mounts).toHaveBeenCalled();
  });

  it('routes signed-out administrators to the prebuilt login, not the driver form', async () => {
    window.history.replaceState({}, '', '/admin');
    render(<App />);

    await screen.findByRole('heading', { name: 'Administrator sign-in' });
    expect(screen.getByTestId('admin-prebuilt-sign-in')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Driver login' })).toBeNull();
    expect(window.location.pathname).toBe('/sign-in');
    expect(new URLSearchParams(window.location.search).get('redirect_url')).toBe('/admin');
    expect(auth.signIn).toHaveBeenCalledWith(expect.objectContaining({
      routing: 'path',
      path: '/sign-in',
      forceRedirectUrl: '/admin',
    }));
    expect(auth.mounts).toHaveBeenCalledTimes(1);
  });

  it('leaves the admin loading state once Clerk resolves as signed out', async () => {
    auth.isLoaded = false;
    window.history.replaceState({}, '', '/admin');
    const { rerender } = render(<App />);
    expect(window.location.pathname).toBe('/admin');
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Driver login' })).toBeNull();

    auth.isLoaded = true;
    rerender(<App />);
    await screen.findByRole('heading', { name: 'Administrator sign-in' });
    expect(screen.getByTestId('admin-prebuilt-sign-in')).toBeTruthy();
    expect(auth.mounts).toHaveBeenCalledTimes(1);
  });

  it('keeps the admin prebuilt screen on Clerk subroutes with the admin return URL', async () => {
    window.history.replaceState({}, '', '/sign-in?redirect_url=%2Fadmin');
    render(<App />);
    const routerPush = auth.providerProps[0].routerPush as (to: string) => void;

    await act(async () => routerPush('/sign-in/sso-callback?redirect_url=%2Fadmin'));
    expect(screen.getByTestId('admin-prebuilt-sign-in')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Driver login' })).toBeNull();
    expect(auth.mounts).toHaveBeenCalledTimes(1);
  });

  it('redirects the legacy admin route to the canonical route with query and hash intact', async () => {
    auth.isLoaded = false;
    window.history.replaceState({}, '', '/admin/drivers?from=bookmark#drivers');
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/admin'));
    expect(window.location.search).toBe('?from=bookmark');
    expect(window.location.hash).toBe('#drivers');
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('uses client-side push and replace navigation while preserving query and hash', async () => {
    window.history.replaceState({}, '', '/sign-in');
    render(<App />);
    await screen.findByRole('heading', { name: 'Driver login' });

    const { routerPush, routerReplace } = auth.providerProps[0] as {
      routerPush: (to: string) => void;
      routerReplace: (to: string) => void;
    };
    const initialLength = window.history.length;

    routerPush('/sign-in/verify?token=abc#code');
    await waitFor(() => expect(window.location.href).toContain('/sign-in/verify?token=abc#code'));
    expect(window.history.length).toBe(initialLength + 1);

    routerReplace('/sign-in?step=complete#finish');
    await waitFor(() => expect(window.location.href).toContain('/sign-in?step=complete#finish'));
    expect(window.history.length).toBe(initialLength + 1);
  });

  it('keeps Clerk mounted across authentication sub-route transitions', async () => {
    window.history.replaceState({}, '', '/sign-in');
    render(<App />);
    await screen.findByRole('heading', { name: 'Driver login' });

    const { routerPush } = auth.providerProps[0] as {
      routerPush: (to: string) => void;
    };
    routerPush('/sign-up/verify?step=1#code');

    await waitFor(() => expect(window.location.pathname).toBe('/sign-up/verify'));
    expect(auth.mounts).toHaveBeenCalledTimes(1);
  });
});