import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeolocationRequestError, requestCurrentPosition } from './geolocation';

describe('requestCurrentPosition', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('turns a browser PositionError object into a catchable Error', async () => {
    const denied = {
      code: 1,
      message: 'User denied Geolocation',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;
    const geolocation = {
      getCurrentPosition: vi.fn((_success, failure) => failure?.(denied)),
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    } as unknown as Geolocation;

    const result = requestCurrentPosition(geolocation);

    await expect(result).rejects.toBeInstanceOf(Error);
    await expect(result).rejects.toMatchObject<Partial<GeolocationRequestError>>({
      name: 'GeolocationRequestError',
      message: 'User denied Geolocation',
      code: 1,
    });
  });

  it('fails safely when a browser never invokes either geolocation callback', async () => {
    vi.useFakeTimers();
    const geolocation = {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    } as unknown as Geolocation;

    const result = requestCurrentPosition(geolocation, { timeout: 15_000 });
    const rejection = expect(result).rejects.toMatchObject<Partial<GeolocationRequestError>>({
      name: 'GeolocationRequestError',
      code: 3,
      message: expect.stringContaining('GPS did not respond'),
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
  });
});