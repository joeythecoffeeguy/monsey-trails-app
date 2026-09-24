import type { LiveTrip } from '@/providers/live-trip';

export const LIVE_LOCATION_MAX_AGE_MS = 90_000;

export type LiveTrackingState = 'live' | 'stale' | 'completed' | 'disconnected' | 'unavailable';

function hasFiniteLocation(trip: LiveTrip) {
  return Boolean(
    trip.currentLocation
    && Number.isFinite(trip.currentLocation.lat)
    && Number.isFinite(trip.currentLocation.lng),
  );
}

export function getLiveTrackingState(
  trip: LiveTrip,
  assignedBusNumber: string | null,
  now = Date.now(),
): LiveTrackingState {
  if (trip.locationVisibility === 'ended' || trip.status === 'stopped') return 'completed';
  if (!assignedBusNumber || trip.locationVisibility !== 'live') return 'unavailable';
  if (
    trip.status !== 'running'
    || !hasFiniteLocation(trip)
  ) {
    return 'disconnected';
  }

  const updatedAt = trip.locationUpdatedAt ? new Date(trip.locationUpdatedAt).getTime() : NaN;
  const age = now - updatedAt;
  return Number.isFinite(age) && age >= 0 && age <= LIVE_LOCATION_MAX_AGE_MS
    ? 'live'
    : 'stale';
}

export function genuineLiveTrackingAvailable(
  trip: LiveTrip,
  assignedBusNumber: string | null,
  now = Date.now(),
) {
  return getLiveTrackingState(trip, assignedBusNumber, now) === 'live';
}