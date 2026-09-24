import assert from 'node:assert/strict';
import test from 'node:test';
import { passengerLocationConfidence } from './location-confidence.ts';

const now = new Date('2026-09-23T12:00:00.000Z').getTime();

test('reports fresh privacy-visible coach coordinates as Live GPS', () => {
  assert.deepEqual(passengerLocationConfidence({
    status: 'running',
    locationVisibility: 'live',
    currentLocation: { lat: 41.1112, lng: -74.0685 },
    locationUpdatedAt: '2026-09-23T11:59:35.000Z',
  }, true, now), {
    kind: 'live',
    label: 'Live GPS',
    ageLabel: 'Updated 25 sec ago',
  });
});

test('reports a published pre-departure route as a Schedule estimate', () => {
  assert.deepEqual(passengerLocationConfidence({
    status: 'ready',
    locationVisibility: 'before_departure',
    currentLocation: null,
  }, true, now), {
    kind: 'schedule',
    label: 'Schedule estimate',
    ageLabel: null,
  });
});

test('reports stale and hidden positions as temporarily unavailable', () => {
  assert.deepEqual(passengerLocationConfidence({
    status: 'running',
    locationVisibility: 'live',
    currentLocation: { lat: 41.1112, lng: -74.0685 },
    locationUpdatedAt: '2026-09-23T11:57:00.000Z',
  }, true, now), {
    kind: 'unavailable',
    label: 'Location temporarily unavailable',
    ageLabel: 'Last GPS update 3 min ago',
  });

  assert.equal(passengerLocationConfidence({
    status: 'running',
    locationVisibility: 'unavailable',
    currentLocation: null,
  }, true, now).kind, 'unavailable');
});

test('uses Schedule estimate while a published run awaits coach assignment', () => {
  assert.equal(passengerLocationConfidence(null, false, now).kind, 'schedule');
  assert.equal(passengerLocationConfidence(null, true, now).kind, 'unavailable');
});