import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverProfileGate } from './driver-profile-gate';

const auth = vi.hoisted(() => ({ signOut: vi.fn(), clearSession: vi.fn() }));
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isLoaded: true, userId: 'test-driver' }),
  useClerk: () => ({ signOut: auth.signOut }),
}));
vi.mock('@/providers/live-trip', () => ({ clearOperatorSession: auth.clearSession }));
vi.mock('./driver-onboarding', async () => {
  const { useUpdateDriverProfile } = await import('@/providers/driver-profile');
  return { DriverOnboarding: () => {
    const mutation = useUpdateDriverProfile();
    return <button onClick={() => mutation.mutate({ unitNumber: 'TEST', phoneNumber: '+12025550100' })}>Complete Profile</button>;
  } };
});
let client: QueryClient;
const profile = { username: 'testdriver', unitNumber: 'TEST', phoneNumber: '+12025550100' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function renderGate() {
  render(<QueryClientProvider client={client}><DriverProfileGate><h1>Driver console</h1></DriverProfileGate></QueryClientProvider>);
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  auth.signOut.mockReset().mockResolvedValue(undefined);
  auth.clearSession.mockClear();
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

describe('signed-in driver account gate', () => {
  it('replaces the spinner with the actual denied-access message, never onboarding or the console', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: 'Account is not provisioned for driver access.', code: 'DRIVER_ACCESS_REQUIRED' }, 403));
    vi.stubGlobal('fetch', fetchMock);
    renderGate();
    expect(screen.getByRole('status').textContent).toContain('Loading your driver account');
    await screen.findByRole('heading', { name: 'Driver access unavailable' });
    expect(screen.getByText('Account is not provisioned for driver access.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Complete Profile')).toBeNull();
    expect(screen.queryByText('Driver console')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens the console after a successful manual retry', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ error: 'Access not assigned', code: 'DRIVER_ACCESS_REQUIRED' }, 403))
      .mockResolvedValueOnce(json({ profile })));
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Driver console' });
  });

  it('shows onboarding only for an authorized account, then opens console directly from the saved profile', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ profile: null }))
      .mockResolvedValueOnce(json({ profile }));
    vi.stubGlobal('fetch', fetchMock);
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Complete Profile' }));
    await screen.findByRole('heading', { name: 'Driver console' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('releases owned coaches before signing out a blocked account', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: 'Access not assigned', code: 'DRIVER_ACCESS_REQUIRED' }, 403))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValue(json({ error: 'Access not assigned' }, 403));
    vi.stubGlobal('fetch', fetchMock);
    renderGate();
    await screen.findByRole('heading', { name: 'Driver access unavailable' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out and use another account' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ redirectUrl: '/sign-in' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/driver/release-coaches', expect.objectContaining({ method: 'POST' }));
    expect(auth.clearSession).toHaveBeenCalled();
  });

  it('keeps an actionable error visible if safe signout fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ error: 'Access not assigned' }, 403))
      .mockResolvedValueOnce(json({ error: 'Unavailable' }, 503)));
    renderGate();
    await screen.findByRole('heading', { name: 'Driver access unavailable' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out and use another account' }));
    await screen.findByText('Could not safely sign out. Check your connection and try again.');
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(auth.clearSession).not.toHaveBeenCalled();
  });
});