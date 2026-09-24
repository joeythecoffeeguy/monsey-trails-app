import type { PrivacyAwarePassengerTrip } from './location-privacy';
import { passengerLocationConfidence } from './location-confidence.ts';

export type MapPoint = { latitude: number; longitude: number };
export type MapStop = MapPoint & {
  id: string;
  label: string;
  status: 'completed' | 'current' | 'upcoming' | 'final';
};

export function validMapPoint(point: { lat: number; lng: number } | null | undefined): MapPoint | null {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)
    || Math.abs(point.lat) > 85 || Math.abs(point.lng) > 180) return null;
  return { latitude: point.lat, longitude: point.lng };
}

export function passengerMapData(trip: PrivacyAwarePassengerTrip | null, assigned: boolean, now: number) {
  const confidence = passengerLocationConfidence(trip, assigned, now);
  const liveCoach = assigned && confidence.kind === 'live' ? validMapPoint(trip?.currentLocation) : null;
  const stops: MapStop[] = (trip?.journeyProgress ?? []).flatMap(stop => {
    const point = validMapPoint(stop);
    return point ? [{ ...point, id: stop.id, label: stop.address, status: stop.status }] : [];
  });
  // Route geometry is supplied with a visible live trip. Never retain a cached
  // GPS-derived route after the position has aged out or the connection fails.
  const route = liveCoach
    ? (trip?.routeGeometry ?? []).flatMap(point => {
      const valid = validMapPoint(point);
      return valid ? [valid] : [];
    })
    : [];
  return { stops, route, liveCoach, confidence };
}