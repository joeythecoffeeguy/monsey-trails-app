import type { Coordinates, PassengerTripSnapshot } from '@workspace/api-client-react';

export type LocationVisibility = 'before_departure' | 'live' | 'ended' | 'unavailable';

export type PrivacyAwarePassengerTrip = PassengerTripSnapshot & {
  locationVisibility: LocationVisibility;
  scheduledDepartureAt: string | null;
  origin?: Coordinates | null;
  routeGeometry?: Coordinates[];
  speedMph?: number | null;
  totalDistanceMiles?: number | null;
  remainingDistanceMiles?: number | null;
};

const VISIBILITIES = new Set<LocationVisibility>([
  'before_departure',
  'live',
  'ended',
  'unavailable',
]);

export function passengerTripVisibility(
  trip: PassengerTripSnapshot | null | undefined,
): LocationVisibility {
  const value = (trip as Partial<PrivacyAwarePassengerTrip> | null | undefined)?.locationVisibility;
  return value && VISIBILITIES.has(value) ? value : 'unavailable';
}

export function protectPassengerTripLocation(
  trip: PassengerTripSnapshot | null | undefined,
  connectionFailed = false,
): PrivacyAwarePassengerTrip | null {
  if (!trip) return null;
  const payload = trip as Partial<PrivacyAwarePassengerTrip> & PassengerTripSnapshot;
  const locationVisibility = connectionFailed ? 'unavailable' : passengerTripVisibility(trip);
  return {
    ...payload,
    locationVisibility,
    scheduledDepartureAt: payload.scheduledDepartureAt ?? null,
    currentLocation: locationVisibility === 'live' ? payload.currentLocation : null,
    origin: locationVisibility === 'live' ? payload.origin : null,
    routeGeometry: locationVisibility === 'live' ? payload.routeGeometry : [],
    speedMph: locationVisibility === 'live' ? payload.speedMph : null,
    eta: locationVisibility === 'live' ? payload.eta : null,
    totalDistanceMiles: locationVisibility === 'live' ? payload.totalDistanceMiles : null,
    remainingDistanceMiles: locationVisibility === 'live' ? payload.remainingDistanceMiles : null,
  };
}