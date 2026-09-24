import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRIVER_REQUEST_TIMEOUT_MS, DriverProfileError, fetchDriverProfile, releaseDriverCoaches, shouldRetryDriverProfile } from './driver-profile';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('bounded driver profile requests', () => {
  it('preserves the server access-denied reason without automatic retries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'This account has not been provisioned for driver access. Contact an administrator.',
      code: 'DRIVER_ACCESS_REQUIRED',
    }), { status: 403 })));
    const error = await fetchDriverProfile().catch((error: Error) => error);
    expect(error).toMatchObject({ status: 403, code: 'DRIVER_ACCESS_REQUIRED' });
    expect(shouldRetryDriverProfile(0, error as Error)).toBe(false);
    expect(shouldRetryDriverProfile(0, new DriverProfileError('Sign in', 401, 'AUTH_REQUIRED'))).toBe(false);
  });

  it('ends a stalled request after 15 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const pending = fetchDriverProfile().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(DRIVER_REQUEST_TIMEOUT_MS);
    const error = await pending;
    expect(error).toMatchObject({ code: 'TIMEOUT' });
    expect(shouldRetryDriverProfile(0, error as Error)).toBe(false);
  });

  it('distinguishes authorized onboarding from a malformed response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({})));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchDriverProfile()).toBeNull();
    await expect(fetchDriverProfile()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('limits transient server retries', () => {
    const error = new DriverProfileError('Unavailable', 503, 'UNAVAILABLE');
    expect(shouldRetryDriverProfile(0, error)).toBe(true);
    expect(shouldRetryDriverProfile(1, error)).toBe(false);
  });

  it('allows an expired account to finish signing out but does not ignore release failures', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Expired' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 })));
    await expect(releaseDriverCoaches()).resolves.toBeUndefined();
    await expect(releaseDriverCoaches()).rejects.toMatchObject({ status: 503 });
  });
});