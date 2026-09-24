import { useEffect, useState, type ReactNode } from 'react';
import { useAuth, useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Link } from 'wouter';
import { releaseDriverCoaches, useDriverProfileQuery } from '@/providers/driver-profile';
import { clearOperatorSession } from '@/providers/live-trip';
import { appUrl } from '@/lib/app-routes';
import { clearDriverOfflineRoutes } from '@/lib/driver-offline-route';
import { DriverOnboarding } from './driver-onboarding';
import { DriverSupport } from './driver-support';

export function DriverProfileGate({ children }: { children: ReactNode }) {
  const query = useDriverProfileQuery();
  const { signOut } = useClerk();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  async function switchAccount() {
    setSigningOut(true);
    setSignOutError('');
    try {
      await releaseDriverCoaches();
      clearOperatorSession();
      queryClient.removeQueries({ queryKey: ['driver-profile'] });
      await signOut({ redirectUrl: appUrl('/sign-in') });
    } catch {
      setSignOutError('Could not safely sign out. Check your connection and try again.');
    } finally {
      setSigningOut(false);
    }
  }

  const error = query.error;
  const errorStatus = error && typeof error === 'object' && 'status' in error
    ? Number(error.status)
    : 0;
  const denied = errorStatus === 403;
  const expired = errorStatus === 401;
  useEffect(() => {
    if ((denied || expired) && userId) clearDriverOfflineRoutes(userId);
  }, [denied, expired, userId]);

  if (!query.isPending && !query.error && query.data !== undefined) {
    return query.data ? children : <DriverOnboarding />;
  }
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#f0f4f8] px-5 py-10 text-slate-900">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-lg">
        <p className="text-xs font-bold tracking-[0.18em] text-secondary">MONSEY TRAILS · DRIVER APP</p>
        {error ? (
          <div role="alert">
            <AlertCircle className="mx-auto mt-6 h-10 w-10 text-amber-600" />
            <h1 className="mt-4 text-2xl font-bold">{denied ? 'Driver access unavailable' : expired ? 'Please sign in again' : 'Unable to load driver account'}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">{error.message}</p>
            {denied && <p className="mt-3 text-sm leading-6 text-slate-600">Use your administrator-issued driver account. If this is that account, ask your administrator to confirm its access.</p>}
            {denied && <DriverSupport />}
            {denied && <Link href="/admin" className="mt-4 block text-sm font-semibold text-secondary underline">Administrator? Manage driver access</Link>}
            <button type="button" disabled={query.isFetching || signingOut} onClick={() => void query.refetch()} className="mt-6 w-full rounded-lg bg-secondary px-4 py-3 font-bold text-secondary-foreground disabled:opacity-50">
              {query.isFetching ? 'Checking account…' : 'Try again'}
            </button>
          </div>
        ) : (
          <div role="status" aria-live="polite">
            <Loader2 className="mx-auto mt-6 h-9 w-9 animate-spin text-secondary" />
            <h1 className="mt-4 text-xl font-bold">Loading your driver account…</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">Checking your driver access. If the connection stalls, you’ll be able to retry.</p>
          </div>
        )}
        <button type="button" disabled={signingOut} onClick={() => void switchAccount()} className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 disabled:opacity-50">
          {signingOut ? 'Signing out…' : 'Sign out and use another account'}
        </button>
        {signOutError && <p role="alert" className="mt-3 text-sm text-red-700">{signOutError}</p>}
      </section>
    </main>
  );
}