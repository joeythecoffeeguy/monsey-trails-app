import test from 'node:test';
import assert from 'node:assert/strict';
import { filterItemsServingExactStops } from './exact-stop-selection.ts';

test('only trips serving both exact verified stop IDs remain', () => {
  const pickup = { id: 'pickup-a', label: 'Main & Maple', lat: 41.1, lng: -74.1, kind: 'pickup' as const };
  const dropoff = { id: 'dropoff-b', label: '9th & 34th', lat: 40.7, lng: -74, kind: 'dropoff' as const };
  const trips = [
    { value: 'both', stops: [{ ...pickup, id: 'another-run-pickup' }, { ...dropoff, id: 'another-run-dropoff' }] },
    { value: 'wrong-pickup', stops: [{ ...pickup, id: 'pickup-c', lat: 41.2 }, dropoff] },
    { value: 'wrong-dropoff', stops: [pickup, { ...dropoff, id: 'dropoff-d', lng: -73.9 }] },
  ];
  assert.deepEqual(filterItemsServingExactStops(trips, pickup, dropoff), ['both']);
});

test('similar labels cannot substitute for shared verified stop identity', () => {
  const pickup = { id: 'pickup-a', label: 'Main & Maple', lat: 41.1, lng: -74.1, kind: 'pickup' as const };
  const dropoff = { id: 'dropoff-b', label: '9th & 34th', lat: 40.7, lng: -74, kind: 'dropoff' as const };
  const trips = [{
    value: 'lookalike',
    stops: [{ ...pickup, id: 'pickup-lookalike', lat: 41.2 }, dropoff],
  }];
  assert.deepEqual(filterItemsServingExactStops(trips, pickup, dropoff), []);
});

test('drop-off must occur after pickup in published order', () => {
  const pickup = { id: 'pickup-a', label: 'Main & Maple', lat: 41.1, lng: -74.1, kind: 'pickup' as const };
  const dropoff = { id: 'dropoff-b', label: '9th & 34th', lat: 40.7, lng: -74, kind: 'dropoff' as const };
  assert.deepEqual(filterItemsServingExactStops([
    { value: 'reverse', stops: [dropoff, pickup] },
  ], pickup, dropoff), []);
});