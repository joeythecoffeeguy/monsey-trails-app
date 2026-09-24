import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function apiTrip(overrides: Record<string, unknown> = {}) {
  const intermediateStops = Array.from({ length: 13 }, (_, index) => ({
    id: `official-stop-${index + 1}`,
    address: `Official Stop ${index + 1}, New York, NY`,
    lat: 40.6 + index / 100,
    lng: -73.99 - index / 100,
    eta: index < 4 ? `2026-09-20T16:${String(index + 5).padStart(2, '0')}:00.000Z` : null,
  }));
  return {
    status: 'ready',
    destinationAddress: 'Monsey, NY',
    destination: { lat: 41.1112, lng: -74.0685 },
    intermediateStops,
    routeGeometry: [{ lat: 40.6, lng: -73.99 }, { lat: 41.1112, lng: -74.0685 }],
    origin: null,
    currentLocation: null,
    totalDistanceMiles: null,
    remainingDistanceMiles: null,
    eta: null,
    speedMph: null,
    startedAt: null,
    emergencyOverride: false,
    emergencyMessage: '',
    routeId: 'route-1',
    displayMode: 'map',
    passengerLanguage: 'en',
    rotationIntervalSeconds: 15,
    arrivalSoundsEnabled: true,
    announcements: [],
    chimeTestRequestedAt: null,
    passengerDisplays: [],
    officialRunKey: '9923-run',
    locationVisibility: 'before_departure',
    scheduledDepartureAt: '2026-09-20T15:00:00.000Z',
    updatedAt: '2026-09-20T15:00:00.000Z',
    ...overrides,
  };
}

async function routeFromPassengerApi(payload: Record<string, unknown>) {
  window.history.replaceState({}, '', '/bus-display');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({
      busNumber: '9923',
      pairingCode: '9923',
      trip: payload,
    }), { status: 200 }),
  ));
  const liveTrip = await import('./live-trip');
  await act(async () => {
    await liveTrip.pairDisplayWithBus('9923');
  });
  const api = await import('./api-interfaces');
  const { result, unmount } = renderHook(() => api.useGPSData('route-1'));
  return { result, unmount };
}

describe('mounted passenger API route integration', () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('keeps all official intermediate stops for ready trips with hidden distance fields', async () => {
    const { result, unmount } = await routeFromPassengerApi(apiTrip());

    expect(result.current.route.id).toBe('live-trip');
    expect(result.current.route.stops).toHaveLength(14);
    expect(result.current.route.stops.slice(0, 13).map(stop => stop.id))
      .toEqual(Array.from({ length: 13 }, (_, index) => `official-stop-${index + 1}`));
    expect(result.current.route.stops.at(-1)).toMatchObject({
      id: 'live-destination',
      name: 'Monsey',
      isDestination: true,
      location: { lat: 41.1112, lng: -74.0685 },
    });
    unmount();
  });

  it('keeps all official intermediate stops while running when distance fields are null', async () => {
    const { result, unmount } = await routeFromPassengerApi(apiTrip({
      status: 'running',
      locationVisibility: 'live',
      currentLocation: { lat: 40.7, lng: -73.95 },
      routeGeometry: [{ lat: 40.7, lng: -73.95 }, { lat: 41.1112, lng: -74.0685 }],
    }));

    expect(result.current.route.id).toBe('live-trip');
    expect(result.current.route.stops).toHaveLength(14);
    expect(result.current.route.stops.filter(stop => !stop.isDestination)).toHaveLength(13);
    expect(result.current.route.stops[0]).toMatchObject({
      id: 'official-stop-1',
      location: { lat: 40.6, lng: -73.99 },
    });
    unmount();
  });
});