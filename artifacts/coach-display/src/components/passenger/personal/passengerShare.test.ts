import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePassengerShare, passengerShareUrl, sharePassengerTrip } from './passengerShare';
import {
  clearSavedPassengerTimes,
  isSafeRunKey,
  readPassengerHistory,
  readPassengerPreferences,
  rememberPassengerTrip,
  savePassengerPreferences,
  setPassengerFavorite,
} from './passengerWebStorage';

const runKey = '2026-09-22|1|2|5|run-17';
const query = '?date=2026-09-22&line=1&origin=2&destination=5&run=2026-09-22%7C1%7C2%7C5%7Crun-17&departure=24%3A15';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('passenger share links', () => {
  it('restores only an exact dated public run', () => {
    expect(parsePassengerShare(query)).toMatchObject({
      runKey,
      departureTime: '24:15',
      filters: { date: '2026-09-22', line: 1, origin: 2, destination: 5 },
    });
    expect(parsePassengerShare(query.replace('destination=5', 'destination=4'))).toBeNull();
    expect(parsePassengerShare(`${query}&code=1234`)).toMatchObject({ runKey });
  });

  it('rejects malformed dates, run ids, and private-looking payloads', () => {
    expect(isSafeRunKey('2026-02-31|1|2|5|run-17')).toBe(false);
    expect(isSafeRunKey('2026-09-22|1|2|5|run 17')).toBe(false);
    expect(parsePassengerShare('?run=driver-secret&departure=10:00')).toBeNull();
  });

  it('builds a minimal link without coach codes or private data', () => {
    const url = passengerShareUrl({
      filters: { date: '2026-09-22', line: 1, origin: 2, destination: 5 },
      runKey,
      departureTime: '24:15',
      view: 'trip',
    });
    expect(url).toMatch(/^https:\/\/coach-passenger-display\.replit\.app\/passengers\?/);
    expect(url).toContain('run=2026-09-22%7C1%7C2%7C5%7Crun-17');
    expect(new URL(url).search).not.toMatch(/coach|driver|code/i);
  });

  it('shares exact stop coordinates and accepts real published run suffixes', () => {
    const publishedRunKey = '2026-09-22|1|2|5|225~21:30:00';
    const url = passengerShareUrl({
      filters: { date: '2026-09-22', line: 1, origin: 2, destination: 5 },
      runKey: publishedRunKey,
      departureTime: '21:30:00',
      view: 'trip',
      pickupStop: { id: 'run-a-1', label: 'Main & Maple', lat: 41.1, lng: -74.1 },
      dropoffStop: { id: 'run-a-8', label: '9th & 34th', lat: 40.7, lng: -74 },
    });
    expect(parsePassengerShare(new URL(url).search)).toMatchObject({
      runKey: publishedRunKey,
      pickupStop: { label: 'Main & Maple', lat: 41.1, lng: -74.1 },
      dropoffStop: { label: '9th & 34th', lat: 40.7, lng: -74 },
    });
  });

  it('accepts the native raw-run link shape and keeps exact stops', () => {
    const nativeQuery = '?date=2026-09-22&line=1&origin=2&destination=5'
      + '&run=225~21%3A30%3A00&departure=21%3A30%3A00'
      + '&pickup=run-a-1&pickupLabel=Main%20%26%20Maple&pickupLat=41.1&pickupLng=-74.1'
      + '&dropoff=run-a-8&dropoffLabel=9th%20%26%2034th&dropoffLat=40.7&dropoffLng=-74';
    expect(parsePassengerShare(nativeQuery)).toMatchObject({
      runKey: '2026-09-22|1|2|5|225~21:30:00',
      pickupStop: { id: 'run-a-1' },
      dropoffStop: { id: 'run-a-8' },
    });
  });

  it('uses clipboard when native sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await expect(sharePassengerTrip('https://example.test/trip', 'Trip')).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://example.test/trip');
  });
});

describe('local passenger preferences and history', () => {
  it('persists language and accessibility choices', () => {
    savePassengerPreferences({ language: 'yi', largeText: true, reducedMotion: true });
    expect(readPassengerPreferences()).toEqual({ language: 'yi', largeText: true, reducedMotion: true });
  });

  it('keeps a recent exact trip without login data', () => {
    rememberPassengerTrip({
      runKey,
      departureTime: '24:15',
      filters: { date: '2026-09-22', line: 1, origin: 2, destination: 5 },
      savedAt: '2026-09-20T12:00:00.000Z',
    });
    expect(readPassengerHistory().recent[0]?.runKey).toBe(runKey);
    clearSavedPassengerTimes();
    expect(readPassengerHistory().recent).toHaveLength(1);
  });

  it('keeps favorites for the same run with different stops distinct', () => {
    const base = {
      runKey,
      departureTime: '24:15',
      filters: { date: '2026-09-22', line: 1, origin: 2, destination: 5 },
      dropoffStop: { id: 'dropoff', label: '9th & 34th', lat: 40.7, lng: -74 },
      savedAt: '2026-09-20T12:00:00.000Z',
    };
    const first = { ...base, pickupStop: { id: 'pickup-a', label: 'Main & Maple', lat: 41.1, lng: -74.1 } };
    const second = { ...base, pickupStop: { id: 'pickup-b', label: 'Route 306 & Maple', lat: 41.2, lng: -74.2 } };
    setPassengerFavorite(first, true);
    setPassengerFavorite(second, true);
    expect(readPassengerHistory().favorites).toHaveLength(2);
  });
});