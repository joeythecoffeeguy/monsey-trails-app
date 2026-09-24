import assert from 'node:assert/strict';
import test from 'node:test';
import type { PassengerTripSnapshot } from '@workspace/api-client-react';
import { protectPassengerTripLocation } from './location-privacy.ts';
import { passengerMapData, validMapPoint } from './journey-map.ts';

const now = Date.parse('2026-09-23T12:00:00.000Z');
function sample(visibility: 'live' | 'before_departure' | 'ended' | 'unavailable', updatedAt = new Date(now - 10_000).toISOString()) {
  return protectPassengerTripLocation({
    locationVisibility: visibility,
    status: 'running',
    currentLocation: { lat: 41.1, lng: -74.1 },
    locationUpdatedAt: updatedAt,
    routeGeometry: [{ lat: 41.1, lng: -74.1 }, { lat: 41.2, lng: -74.2 }],
    journeyProgress: [
      { id: 's1', address: 'Main & First', lat: 41.2, lng: -74.2, eta: null, status: 'current' },
    ],
  } as unknown as PassengerTripSnapshot);
}

test('shows route, stop and coach only when GPS is visibility-approved and fresh', () => {
  const data = passengerMapData(sample('live'), true, now);
  assert.equal(data.confidence.kind, 'live');
  assert.deepEqual(data.liveCoach, { latitude: 41.1, longitude: -74.1 });
  assert.equal(data.route.length, 2);
  assert.equal(data.stops[0].label, 'Main & First');
});

test('hides coach and GPS route when stale, in the future, private, or offline', () => {
  const cases = [
    sample('live', new Date(now - 91_000).toISOString()),
    sample('live', new Date(now + 1000).toISOString()),
    sample('before_departure'),
    sample('ended'),
    sample('unavailable'),
    protectPassengerTripLocation(sample('live'), true),
  ];
  for (const trip of cases) {
    const data = passengerMapData(trip, true, now);
    assert.equal(data.liveCoach, null);
    assert.deepEqual(data.route, []);
    assert.equal(data.stops.length, 1);
  }
  assert.equal(passengerMapData(sample('live'), false, now).liveCoach, null);
  assert.deepEqual(passengerMapData(sample('live'), false, now).route, []);
  assert.deepEqual(passengerMapData(null, false, now).stops, []);
});

test('rejects invalid coordinates without blanking valid stops and route', () => {
  const trip = sample('live')!;
  trip.routeGeometry = [{ lat: NaN, lng: -74 }, { lat: 41.1, lng: -74.1 }, { lat: 41.2, lng: -74.2 }];
  assert.equal(passengerMapData(trip, true, now).route.length, 2);
  assert.equal(validMapPoint({ lat: 91, lng: 0 }), null);
  assert.equal(validMapPoint({ lat: 40, lng: 181 }), null);
});