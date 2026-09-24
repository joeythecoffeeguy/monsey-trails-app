import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { appUrl } from '@/lib/app-routes';

export class DriverProfileError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
    this.name = 'DriverProfileError';
  }
}

export const DRIVER_REQUEST_TIMEOUT_MS = 15_000;

async function driverRequest(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  init.signal?.addEventListener('abort', cancel, { once: true });
  if (init.signal?.aborted) cancel();
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DRIVER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(appUrl(path), { ...init, signal: controller.signal });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new DriverProfileError(
        data?.error || 'Could not load your driver account. Please try again.',
        response.status,
        data?.code || 'REQUEST_FAILED',
      );
    }
    if (!data) throw new DriverProfileError('The server returned an invalid response. Please try again.', 0, 'INVALID_RESPONSE');
    return data;
  } catch (error) {
    if (timedOut) {
      throw new DriverProfileError('Loading your driver account took too long. Check your connection and try again.', 0, 'TIMEOUT');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    init.signal?.removeEventListener('abort', cancel);
  }
}

export async function fetchDriverProfile(signal?: AbortSignal): Promise<DriverProfile | null> {
  const data = await driverRequest('/api/driver/profile', { signal });
  if (data && data.profile === null) return null;
  const profile = data?.profile;
  if (!profile || !['username', 'unitNumber', 'phoneNumber'].every((key) => typeof profile[key] === 'string')) {
    throw new DriverProfileError('The server returned an invalid driver profile. Please try again.', 0, 'INVALID_RESPONSE');
  }
  return profile;
}

export function shouldRetryDriverProfile(failureCount: number, error: Error) {
  // Authorization failures require an account change, not repeated requests.
  if (error instanceof DriverProfileError) return error.status >= 500 && failureCount < 1;
  return failureCount < 1;
}

export async function releaseDriverCoaches() {
  try {
    await driverRequest('/api/driver/release-coaches', { method: 'POST' });
  } catch (error) {
    // An expired session is already signed out on the server.
    if (!(error instanceof DriverProfileError && error.status === 401)) throw error;
  }
}

export interface DriverProfile {
  username: string;
  unitNumber: string;
  phoneNumber: string;
}

export interface DriverProfileInput {
  unitNumber: string;
  phoneNumber: string;
}

export function useDriverProfileQuery() {
  const { isLoaded, userId } = useAuth();
  return useQuery({
    queryKey: ['driver-profile', userId],
    enabled: isLoaded && Boolean(userId),
    queryFn: ({ signal }) => fetchDriverProfile(signal),
    networkMode: 'always',
    retry: shouldRetryDriverProfile,
    retryOnMount: false,
    staleTime: 60_000,
  });
}

export function useUpdateDriverProfile() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async (profile: DriverProfileInput) => {
      const data = await driverRequest('/api/driver/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      return data.profile as DriverProfile;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(['driver-profile', userId], profile);
    },
  });
}
