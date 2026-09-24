import assert from 'node:assert/strict';
import test from 'node:test';
import type { PassengerTripSnapshot } from '@workspace/api-client-react';
import { protectPassengerTripLocation } from './location-privacy.ts';

function trip(
  locationVisibility: 'before_departure' | 'live' | 'ended' | 'unavailable' | undefined,
): PassengerTripSnapshot {
  return {
    ...(locationVisibility ? { locationVisibility } : {}),
    scheduledDepartureAt: '2026-09-16T15:00:00.000Z',
    operatorPairingCode: '1234',
    passengerCode: '5678',
    language: 'en',
    active: true,
    status: 'running',
    currentLocation: { lat: 41.1112, lng: -74.0685 },
    origin: { lat: 41.1, lng: -74.1 },
    routeGeometry: [{ lat: 41.1, lng: -74.1 }, { lat: 40.75, lng: -73.98 }],
    speedMph: 43,
    totalDistanceMiles: 31,
    remainingDistanceMiles: 18,
    upcomingStops: [],
    journeyProgress: [],
    eta: '2026-09-16T16:00:00.000Z',
    updatedAt: '2026-09-16T15:30:00.000Z',
    announcements: [],
  } as PassengerTripSnapshot;
}

test('clears every cached GPS-derived field when a refresh fails', () => {
  const protectedTrip = protectPassengerTripLocation(trip('live'), true);

  assert.equal(protectedTrip?.locationVisibility, 'unavailable');
  assert.equal(protectedTrip?.currentLocation, null);
  assert.equal(protectedTrip?.origin, null);
  assert.deepEqual(protectedTrip?.routeGeometry, []);
  assert.equal(protectedTrip?.speedMph, null);
  assert.equal(protectedTrip?.eta, null);
  assert.equal(protectedTrip?.totalDistanceMiles, null);
  assert.equal(protectedTrip?.remainingDistanceMiles, null);
});

test('treats legacy payloads without visibility as hidden', () => {
  const protectedTrip = protectPassengerTripLocation(trip(undefined));

  assert.equal(protectedTrip?.locationVisibility, 'unavailable');
  assert.equal(protectedTrip?.currentLocation, null);
  assert.equal(protectedTrip?.origin, null);
  assert.deepEqual(protectedTrip?.routeGeometry, []);
  assert.equal(protectedTrip?.eta, null);
});

test('retains server fields only while visibility is live', () => {
  const protectedTrip = protectPassengerTripLocation(trip('live'));

  assert.deepEqual(protectedTrip?.currentLocation, { lat: 41.1112, lng: -74.0685 });
  assert.equal(protectedTrip?.speedMph, 43);
  assert.equal(protectedTrip?.remainingDistanceMiles, 18);
});