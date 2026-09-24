import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeGeometry = [
  { lat: 41.1112, lng: -74.0685 },
  { lat: 40.7549, lng: -73.984 },
];

function trip(overrides: Record<string, unknown> = {}) {
  return {
    status: 'running',
    destinationAddress: 'Midtown, New York, NY',
    destination: routeGeometry[1],
    intermediateStops: [],
    routeGeometry,
    origin: routeGeometry[0],
    currentLocation: routeGeometry[0],
    totalDistanceMiles: 31,
    remainingDistanceMiles: 20,
    eta: '2026-09-16T16:00:00.000Z',
    speedMph: 45,
    startedAt: '2026-09-16T15:00:00.000Z',
    emergencyOverride: false,
    emergencyMessage: '',
    routeId: 'route-1',
    displayMode: 'map',
    rotationIntervalSeconds: 15,
    locationVisibility: 'live',
    scheduledDepartureAt: '2026-09-16T15:00:00.000Z',
    updatedAt: '2026-09-16T15:30:00.000Z',
    ...overrides,
  };
}

describe('live trip polling', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, '', '/bus-display');
  });

  it('starts polling when a subscribed display pairs and receives saved stop updates without reloading', async () => {
    vi.useFakeTimers();
    const savedStops = [
      {
        id: 'saved-stop',
        address: 'Route 59 & Main Street, Monsey, NY',
        lat: 41.111,
        lng: -74.067,
        eta: null,
      },
    ];
    let passengerGetCount = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({
          busNumber: '9923',
          pairingCode: '4821',
          trip: trip(),
        }), { status: 200 }));
      }

      passengerGetCount += 1;
      return Promise.resolve(new Response(JSON.stringify(trip({
        intermediateStops: passengerGetCount > 1 ? savedStops : [],
        updatedAt: passengerGetCount > 1
          ? '2026-09-16T15:32:00.000Z'
          : '2026-09-16T15:31:00.000Z',
      })), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    const { result, unmount } = renderHook(() => liveTrip.useLiveTrip());

    await act(async () => {
      await liveTrip.pairDisplayWithBus('4821');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(passengerGetCount).toBe(1);
    expect(result.current.intermediateStops).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(liveTrip.LIVE_TRIP_REFRESH_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(passengerGetCount).toBe(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/trips/4821?'),
      expect.objectContaining({ credentials: 'same-origin' }),
    );
    expect(result.current.intermediateStops).toEqual(savedStops);

    unmount();
    vi.useRealTimers();
  });

  it('retains bus-scoped cached geometry when a poll response omits it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        busNumber: '9923',
        pairingCode: '4821',
        trip: trip(),
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(trip({
        routeGeometry: undefined,
        remainingDistanceMiles: 18,
        updatedAt: '2026-09-16T15:31:00.000Z',
      })), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    await liveTrip.pairDisplayWithBus('4821');
    await liveTrip.refreshLiveTrip();

    const { result } = renderHook(() => liveTrip.useLiveTrip());
    expect(result.current.routeGeometry).toEqual(routeGeometry);
    expect(result.current.remainingDistanceMiles).toBe(18);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/trips/4821?geometryVersion=2026-09-16T15%3A30%3A00.000Z&viewer=passenger',
      expect.any(Object),
    );
  });

  it('replaces cached route fields when the driver clears the route', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        busNumber: '9923',
        pairingCode: '4821',
        trip: trip(),
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(trip({
        status: 'idle',
        destinationAddress: '',
        destination: null,
        intermediateStops: [],
        routeGeometry: [],
        origin: null,
        totalDistanceMiles: null,
        remainingDistanceMiles: null,
        eta: null,
        speedMph: null,
        startedAt: null,
        updatedAt: '2026-09-16T15:31:00.000Z',
      })), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    await liveTrip.pairDisplayWithBus('4821');
    await liveTrip.refreshLiveTrip();

    const { result } = renderHook(() => liveTrip.useLiveTrip());
    expect(result.current.status).toBe('idle');
    expect(result.current.destination).toBeNull();
    expect(result.current.destinationAddress).toBe('');
    expect(result.current.intermediateStops).toEqual([]);
    expect(result.current.routeGeometry).toEqual([]);
  });

  it('discovers the assigned bus from an exact published run without passenger bus input', async () => {
    window.history.replaceState({}, '', '/passengers');
    const runKey = '2026-09-17|1|1|3|run_42';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      assigned: true,
      coachNumber: '9923',
      trip: trip({ officialRunKey: runKey }),
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    liveTrip.connectPersonalPassenger(runKey, '15:30');
    await liveTrip.refreshLiveTrip();

    const { result } = renderHook(() => liveTrip.useLiveTrip());
    expect(result.current.officialRunKey).toBe(runKey);
    expect(liveTrip.getPersonalBusNumber()).toBe('9923');
    expect(liveTrip.getPersonalRunKey()).toBe(runKey);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/passenger/public-run/${encodeURIComponent(runKey)}`,
      expect.any(Object),
    );
  });

  it('treats an unassigned published run as a successful empty live state', async () => {
    window.history.replaceState({}, '', '/passengers');
    const runKey = '2026-09-17|1|1|3|run_43';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      assigned: false,
      coachNumber: null,
      trip: null,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    liveTrip.connectPersonalPassenger(runKey, '16:30');
    await liveTrip.refreshLiveTrip();

    const { result } = renderHook(() => liveTrip.useLiveTrip());
    expect(result.current.status).toBe('idle');
    expect(liveTrip.getPersonalBusNumber()).toBe('');
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/api/passenger/public-run/'))).toBe(true);
  });

  it('immediately removes cached passenger GPS when the server hides location', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        busNumber: '9923',
        pairingCode: '4821',
        trip: trip(),
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(trip({
        locationVisibility: 'before_departure',
        currentLocation: null,
        origin: null,
        routeGeometry: [],
        speedMph: null,
      })), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    await liveTrip.pairDisplayWithBus('4821');
    await liveTrip.refreshLiveTrip();

    const { result } = renderHook(() => liveTrip.useLiveTrip());
    expect(result.current.locationVisibility).toBe('before_departure');
    expect(result.current.currentLocation).toBeNull();
    expect(result.current.origin).toBeNull();
    expect(result.current.routeGeometry).toEqual([]);
    expect(result.current.speedMph).toBeNull();
    expect(result.current.eta).toBeNull();
    expect(result.current.totalDistanceMiles).toBeNull();
    expect(result.current.remainingDistanceMiles).toBeNull();
  });

  it('sends the real guarded arrival payload and publishes intermediate completion', async () => {
    window.history.replaceState({}, '', '/operator');
    const running = trip({
      intermediateStops: [{ id: 'pickup-1', address: 'Main Street', lat: 41.1, lng: -74.1 }],
    });
    const advanced = trip({ intermediateStops: [], updatedAt: '2026-09-16T15:31:00.000Z' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        busNumber: '9923',
        pairingCode: '4821',
        trip: running,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        trip: advanced,
        arrivedAt: 'Main Street',
        nextDestination: advanced.destinationAddress,
        tripComplete: false,
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    await liveTrip.connectOperatorToBus('9923');
    const result = await liveTrip.arriveAtNextDestination('pickup-1', running.startedAt);

    expect(result.tripComplete).toBe(false);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/trips/9923/arrive',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          expectedStopIdentity: 'pickup-1',
          expectedStartedAt: running.startedAt,
        }),
      }),
    );
    const { result: snapshot } = renderHook(() => liveTrip.useLiveTrip());
    expect(snapshot.current.intermediateStops).toEqual([]);
  });

  it('surfaces arrival errors and does not publish a failed final completion', async () => {
    window.history.replaceState({}, '', '/operator');
    const running = trip({ intermediateStops: [] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        busNumber: '9923',
        pairingCode: '4821',
        trip: running,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'The trip changed. Refresh before completing this stop.',
      }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    await liveTrip.connectOperatorToBus('9923');

    await expect(liveTrip.arriveAtNextDestination(
      `${running.destination.lat}:${running.destination.lng}`,
      running.startedAt,
    )).rejects.toThrow('The trip changed. Refresh before completing this stop.');
    const { result: snapshot } = renderHook(() => liveTrip.useLiveTrip());
    expect(snapshot.current.status).toBe('running');
    expect(snapshot.current.startedAt).toBe(running.startedAt);
  });

  it('treats legacy passenger payloads without visibility as hidden', async () => {
    const legacyTrip: Record<string, unknown> = trip();
    delete legacyTrip.locationVisibility;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      busNumber: '9923',
      pairingCode: '4821',
      trip: legacyTrip,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    await liveTrip.pairDisplayWithBus('4821');

    const { result } = renderHook(() => liveTrip.useLiveTrip());
    expect(result.current.locationVisibility).toBe('unavailable');
    expect(result.current.currentLocation).toBeNull();
    expect(result.current.routeGeometry).toEqual([]);
  });

  it('clears a mounted display pairing after the operator rotates its code', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        busNumber: '9923',
        pairingCode: '4821',
        trip: trip(),
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'Passenger pairing code is invalid.',
      }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    await liveTrip.pairDisplayWithBus('4821');
    expect(liveTrip.getDisplayBusNumber()).toBe('4821');

    await liveTrip.refreshLiveTrip();

    expect(liveTrip.getDisplayBusNumber()).toBe('');
  });

  it('keeps polling an ended exact run so a corrected active assignment can become live', async () => {
    window.history.replaceState({}, '', '/');
    const runKey = '2026-09-17|1|1|3|run_42';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        assigned: true,
        coachNumber: '9923',
        trip: trip({
          locationVisibility: 'ended',
          currentLocation: null,
          origin: null,
          routeGeometry: [],
        }),
      }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({
        assigned: true,
        coachNumber: '9930',
        trip: trip({ officialRunKey: runKey }),
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const liveTrip = await import('./live-trip');
    liveTrip.connectPersonalPassenger(runKey, '15:30');
    await liveTrip.refreshLiveTrip();
    await liveTrip.refreshLiveTrip();

    const { result } = renderHook(() => liveTrip.useLiveTrip());
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.locationVisibility).toBe('live');
    expect(result.current.currentLocation).toEqual(routeGeometry[0]);
    expect(liveTrip.getPersonalBusNumber()).toBe('9930');
  });
});