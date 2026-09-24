export function passengerRouteView(search: string): 'trip' | 'live' {
  return new URLSearchParams(search).get('view') === 'live' ? 'live' : 'trip';
}

export function livePageCanUseBrowserBack(state: unknown) {
  if (!state || typeof state !== 'object') return false;
  const historyState = state as Record<string, unknown>;
  return historyState.passengerView === 'live'
    && historyState.passengerHistoryOwned === true
    && historyState.passengerLiveFromTrip === true;
}

export function tripPageCanUseBrowserBack(state: unknown) {
  if (!state || typeof state !== 'object') return false;
  const historyState = state as Record<string, unknown>;
  return historyState.passengerView === 'trip' && historyState.passengerHistoryOwned === true;
}

export interface PassengerHistoryUrls {
  schedule: string;
  trip: string;
  live: string;
}

export function installDirectLiveHistory(history: History, urls: PassengerHistoryUrls) {
  const existing = history.state && typeof history.state === 'object'
    ? history.state as Record<string, unknown>
    : {};
  if (
    existing.passengerView === 'live'
    && existing.passengerHistoryOwned === true
    && existing.passengerLiveFromTrip === true
  ) {
    return false;
  }

  history.replaceState({
    ...existing,
    passengerView: 'schedule',
    passengerHistoryOwned: true,
    passengerLiveFromTrip: false,
  }, '', urls.schedule);
  history.pushState({
    ...existing,
    passengerView: 'trip',
    passengerHistoryOwned: true,
    passengerLiveFromTrip: false,
  }, '', urls.trip);
  history.pushState({
    ...existing,
    passengerView: 'live',
    passengerHistoryOwned: true,
    passengerLiveFromTrip: true,
  }, '', urls.live);
  return true;
}