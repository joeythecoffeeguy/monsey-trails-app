export const LIVE_GPS_MAX_AGE_MS = 90_000;

export type PassengerLocationConfidence = {
  kind: 'live' | 'schedule' | 'unavailable';
  label: 'Live GPS' | 'Schedule estimate' | 'Location temporarily unavailable';
  ageLabel: string | null;
};

type LocationSnapshot = {
  status?: string | null;
  locationVisibility?: string | null;
  currentLocation?: { lat: number; lng: number } | null;
  locationUpdatedAt?: string | null;
};

function ageMs(timestamp: string | null | undefined, now: number) {
  if (!timestamp) return null;
  const age = now - new Date(timestamp).getTime();
  return Number.isFinite(age) && age >= 0 ? age : null;
}

export function formatLocationUpdateAge(age: number) {
  const seconds = Math.floor(age / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'} ago`;
}

export function passengerLocationConfidence(
  trip: LocationSnapshot | null | undefined,
  assigned: boolean,
  now = Date.now(),
): PassengerLocationConfidence {
  if (!trip) {
    return assigned
      ? { kind: 'unavailable', label: 'Location temporarily unavailable', ageLabel: null }
      : { kind: 'schedule', label: 'Schedule estimate', ageLabel: null };
  }

  const updateAge = ageMs(trip.locationUpdatedAt, now);
  const hasPosition = Boolean(
    trip.currentLocation
    && Number.isFinite(trip.currentLocation.lat)
    && Number.isFinite(trip.currentLocation.lng),
  );
  if (
    trip.status === 'running'
    && trip.locationVisibility === 'live'
    && hasPosition
    && updateAge !== null
    && updateAge <= LIVE_GPS_MAX_AGE_MS
  ) {
    return {
      kind: 'live',
      label: 'Live GPS',
      ageLabel: `Updated ${formatLocationUpdateAge(updateAge)}`,
    };
  }

  if (trip.locationVisibility === 'before_departure' || trip.status === 'ready') {
    return { kind: 'schedule', label: 'Schedule estimate', ageLabel: null };
  }

  return {
    kind: 'unavailable',
    label: 'Location temporarily unavailable',
    ageLabel: updateAge === null ? null : `Last GPS update ${formatLocationUpdateAge(updateAge)}`,
  };
}