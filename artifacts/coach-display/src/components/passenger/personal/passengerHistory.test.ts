import { describe, expect, it } from 'vitest';
import { installDirectLiveHistory, livePageCanUseBrowserBack, passengerRouteView, tripPageCanUseBrowserBack } from './passengerHistory';

function traverseHistory(direction: 'back' | 'forward') {
  return new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history[direction]();
  });
}

describe('personal passenger live-map history', () => {
  it('recognizes a distinct, refreshable live tracking URL', () => {
    expect(passengerRouteView('?date=2026-09-16&run=run-key&view=live')).toBe('live');
    expect(passengerRouteView('?date=2026-09-16&run=run-key')).toBe('trip');
  });

  it('uses browser Back only when the live page was pushed from trip details', () => {
    expect(livePageCanUseBrowserBack({
      passengerView: 'live',
      passengerHistoryOwned: true,
      passengerLiveFromTrip: true,
    })).toBe(true);
    expect(livePageCanUseBrowserBack({ passengerView: 'live', passengerLiveFromTrip: false })).toBe(false);
    expect(livePageCanUseBrowserBack({ passengerView: 'live', passengerLiveFromTrip: true })).toBe(false);
    expect(livePageCanUseBrowserBack(null)).toBe(false);
    expect(tripPageCanUseBrowserBack({ passengerView: 'trip', passengerHistoryOwned: true })).toBe(true);
    expect(tripPageCanUseBrowserBack({ passengerView: 'trip' })).toBe(false);
  });

  it('builds direct live -> trip -> schedule history once and preserves all filters', async () => {
    const query = 'date=2026-09-16&line=1&origin=2&destination=5';
    const run = '2026-09-16%7C1%7C2%7C5%7C815';
    const schedule = `/passengers?${query}`;
    const trip = `${schedule}&run=${run}&departure=08%3A15`;
    const live = `${trip}&view=live`;
    window.history.replaceState({}, '', live);

    expect(installDirectLiveHistory(window.history, { schedule, trip, live })).toBe(true);
    expect(window.location.pathname + window.location.search).toBe(live);

    await traverseHistory('back');
    expect(window.location.pathname + window.location.search).toBe(trip);
    expect(window.history.state.passengerView).toBe('trip');

    await traverseHistory('back');
    expect(window.location.pathname + window.location.search).toBe(schedule);
    expect(window.history.state.passengerView).toBe('schedule');

    await traverseHistory('forward');
    await traverseHistory('forward');
    expect(window.location.pathname + window.location.search).toBe(live);

    // A reload reruns initialization against the current persisted history state.
    expect(installDirectLiveHistory(window.history, { schedule, trip, live })).toBe(false);
    await traverseHistory('back');
    expect(window.location.pathname + window.location.search).toBe(trip);
  });
});