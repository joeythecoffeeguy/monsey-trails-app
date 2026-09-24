import { describe, expect, it } from 'vitest';
import type { LiveTrip } from '@/providers/live-trip';
import { getLiveTrackingState, genuineLiveTrackingAvailable } from './liveTracking';

const now = Date.parse('2026-09-16T12:00:00.000Z');

function trip(overrides: Partial<LiveTrip> = {}): LiveTrip {
  return {
    status: 'running',
    destinationAddress: '',
    destination: null,
    intermediateStops: [],
    routeGeometry: [],
    origin: null,
    currentLocation: { lat: 41.1, lng: -74.1 },
    totalDistanceMiles: null,
    remainingDistanceMiles: null,
    eta: null,
    speedMph: null,
    startedAt: null,
    emergencyOverride: false,
    emergencyMessage: '',
    routeId: 'route',
    displayMode: 'auto',
    passengerLanguage: 'en',
    rotationIntervalSeconds: 15,
    arrivalSoundsEnabled: true,
    announcements: [],
    chimeTestRequestedAt: null,
    passengerDisplays: [],
    locationVisibility: 'live',
    scheduledDepartureAt: null,
    updatedAt: new Date(now).toISOString(),
    locationUpdatedAt: new Date(now - 30_000).toISOString(),
    ...overrides,
  };
}

describe('passenger live tracking availability', () => {
  it('requires an assigned running coach with finite fresh public GPS', () => {
    expect(genuineLiveTrackingAvailable(trip(), '9923', now)).toBe(true);
    expect(genuineLiveTrackingAvailable(trip(), null, now)).toBe(false);
    expect(genuineLiveTrackingAvailable(trip({ status: 'ready' }), '9923', now)).toBe(false);
    expect(genuineLiveTrackingAvailable(trip({ currentLocation: { lat: NaN, lng: -74 } }), '9923', now)).toBe(false);
  });

  it('does not treat forecast/predeparture or stale data as live', () => {
    expect(getLiveTrackingState(trip({ locationVisibility: 'before_departure' }), '9923', now)).toBe('unavailable');
    expect(getLiveTrackingState(trip({ locationUpdatedAt: new Date(now - 91_000).toISOString() }), '9923', now)).toBe('stale');
  });

  it('reports state loss without retaining a live label', () => {
    expect(getLiveTrackingState(trip({ locationVisibility: 'ended', status: 'stopped' }), '9923', now)).toBe('completed');
    expect(getLiveTrackingState(trip({ currentLocation: null }), '9923', now)).toBe('disconnected');
    expect(getLiveTrackingState(trip({ locationVisibility: 'unavailable', currentLocation: null }), '9923', now)).toBe('unavailable');
  });
});