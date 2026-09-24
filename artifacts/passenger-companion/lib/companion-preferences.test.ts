import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeRunLink,
  encodeRunLink,
  followingDayLabel,
  invalidateOfflineScheduleStatuses,
  prependUniqueChoice,
  toggleFavorite,
} from './companion-preferences.ts';

test('an exact shared run round-trips without losing its stable identity', () => {
  const selection = { date: '2026-09-20', line: 1, origin: 2, destination: 5, runId: 'run-42' };
  assert.deepEqual(decodeRunLink(encodeRunLink(selection)), { ...selection, pickup: null, dropoff: null });
  assert.equal(decodeRunLink('monsey-trails-passenger://run?date=nope&run=42'), null);
});

test('native accepts a web exact-run link with published tilde/colon run IDs', () => {
  const url = 'https://example.test/passengers?date=2026-09-20&line=1&origin=2&destination=5'
    + '&run=2026-09-20%7C1%7C2%7C5%7C225~21%3A30%3A00'
    + '&pickup=run-a-1&pickupLabel=Main%20%26%20Maple&pickupLat=41.1&pickupLng=-74.1'
    + '&dropoff=run-a-8&dropoffLabel=9th%20%26%2034th&dropoffLat=40.7&dropoffLng=-74';
  assert.deepEqual(decodeRunLink(url), {
    date: '2026-09-20', line: 1, origin: 2, destination: 5, runId: '225~21:30:00',
    pickup: { id: 'run-a-1', label: 'Main & Maple', kind: 'pickup', lat: 41.1, lng: -74.1 },
    dropoff: { id: 'run-a-8', label: '9th & 34th', kind: 'dropoff', lat: 40.7, lng: -74 },
  });
});

test('exact pickup and drop-off identities survive sharing and distinguish favorites', () => {
  const base = { date: '2026-09-20', line: 1, origin: 2, destination: 5, runId: 'run-42' };
  const pickup = { id: 'verified-pickup-1', label: 'Main Street & Maple Avenue', kind: 'pickup' as const, lat: 41.1, lng: -74.1 };
  const dropoff = { id: 'verified-dropoff-8', label: '34th Street & 9th Avenue', kind: 'dropoff' as const, lat: 40.7, lng: -74 };
  assert.deepEqual(decodeRunLink(encodeRunLink({ ...base, pickup, dropoff })), { ...base, pickup, dropoff });
  const first = { line: 1, origin: 2, destination: 5, label: 'Monsey → Manhattan', pickup, dropoff };
  const second = { ...first, pickup: { id: 'verified-pickup-2', label: 'Route 306 & Maple Avenue', kind: 'pickup' as const, lat: 41.2, lng: -74.2 } };
  assert.equal(toggleFavorite([first], second).length, 2);
});

test('favorites toggle locally and recents remain unique', () => {
  const route = { line: 1, origin: 2, destination: 5, label: 'Monsey → Manhattan' };
  assert.deepEqual(toggleFavorite([], route), [route]);
  assert.deepEqual(toggleFavorite([route], route), []);
  assert.deepEqual(prependUniqueChoice([route], { ...route, label: 'Updated label' }), [{ ...route, label: 'Updated label' }]);
});

test('extended transit hours are explicitly marked as the next calendar day', () => {
  assert.equal(followingDayLabel('2026-09-20', '24:15:00'), ' · next calendar day');
  assert.equal(followingDayLabel('2026-09-20', '23:15:00'), '');
});

test('offline schedules never retain stale live status claims', () => {
  const schedule = {
    source: 'published',
    fetchedAt: '2026-09-20T12:00:00Z',
    date: '2026-09-20',
    origin: { id: 2, name: 'Monsey' },
    destination: { id: 5, name: 'Manhattan' },
    keyLegend: [],
    runs: [{ id: '225~21:30:00', departureStatus: 'on_time', delayMinutes: 0 }],
  } as unknown as Parameters<typeof invalidateOfflineScheduleStatuses>[0];
  const offline = invalidateOfflineScheduleStatuses(schedule);
  assert.equal(offline.runs[0].departureStatus, 'unavailable');
  assert.equal(offline.runs[0].delayMinutes, null);
});