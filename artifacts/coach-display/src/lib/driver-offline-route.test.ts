import { beforeEach, describe, expect, it } from 'vitest';
import { clearDriverOfflineRoutes, loadDriverOfflineRoute, OFFLINE_ROUTE_MAX_AGE_MS, saveDriverOfflineRoute } from './driver-offline-route';
import type { LiveTrip } from '@/providers/live-trip';

const trip = {
  officialRunKey: 'run-exact-1',
  destinationAddress: 'Main terminal',
  destinationNote: 'Use assigned bay',
  destination: { lat: 41, lng: -74 },
  intermediateStops: [{ id: 'stop-1', address: 'First stop', note: 'Curbside', lat: 40.9, lng: -74.1, eta: 'secret-derived-time' }],
  routeGeometry: [{ lat: 40.9, lng: -74.1 }, { lat: 41, lng: -74 }],
} as LiveTrip;

describe('driver offline route cache', () => {
  beforeEach(() => localStorage.clear());

  it('stores only route essentials and scopes the copy to driver and coach', () => {
    const saved = saveDriverOfflineRoute({
      driverSubject: 'driver-a',
      coachNumber: ' 22 ',
      trip,
      lastSuccessfulSyncAt: 1_000,
      now: 2_000,
    });

    expect(loadDriverOfflineRoute('driver-a', '22', 2_001)).toEqual(saved);
    expect(loadDriverOfflineRoute('driver-b', '22', 2_001)).toBeNull();
    expect(loadDriverOfflineRoute('driver-a', '23', 2_001)).toBeNull();
    expect(JSON.stringify(saved)).not.toContain('secret-derived-time');
    expect(JSON.stringify(saved)).not.toContain('pairing');
    expect(JSON.stringify(saved)).not.toContain('currentLocation');
  });

  it('replaces an old assignment and expires saved routes', () => {
    saveDriverOfflineRoute({ driverSubject: 'driver-a', coachNumber: '22', trip, lastSuccessfulSyncAt: 1_000, now: 2_000 });
    saveDriverOfflineRoute({
      driverSubject: 'driver-a',
      coachNumber: '23',
      trip: { ...trip, officialRunKey: 'run-exact-2' },
      lastSuccessfulSyncAt: 3_000,
      now: 4_000,
    });

    expect(loadDriverOfflineRoute('driver-a', '22', 4_001)).toBeNull();
    expect(loadDriverOfflineRoute('driver-a', '23', 4_001)?.officialRunKey).toBe('run-exact-2');
    expect(loadDriverOfflineRoute('driver-a', '23', 4_000 + OFFLINE_ROUTE_MAX_AGE_MS)).toBeNull();
  });

  it('clears the authenticated driver without clearing another driver', () => {
    const now = Date.now();
    saveDriverOfflineRoute({ driverSubject: 'driver-a', coachNumber: '22', trip, lastSuccessfulSyncAt: now - 1_000, now });
    saveDriverOfflineRoute({ driverSubject: 'driver-b', coachNumber: '24', trip, lastSuccessfulSyncAt: now - 1_000, now });
    clearDriverOfflineRoutes('driver-a');
    expect(loadDriverOfflineRoute('driver-a', '22', now + 1)).toBeNull();
    expect(loadDriverOfflineRoute('driver-b', '24', now + 1)).not.toBeNull();
  });
});