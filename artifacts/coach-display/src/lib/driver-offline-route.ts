import type { LiveTrip, TripStop } from '@/providers/live-trip';
import type { Coordinates } from '@/providers/api-interfaces';

const STORAGE_KEY = 'coach-driver-offline-routes-v1';
export const OFFLINE_ROUTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface SavedDriverRoute {
  version: 1;
  driverSubject: string;
  coachNumber: string;
  officialRunKey: string;
  destinationAddress: string;
  destinationNote?: string;
  destination: Coordinates;
  stops: TripStop[];
  routeGeometry: Coordinates[];
  savedAt: number;
  lastSuccessfulSyncAt: number;
  expiresAt: number;
}

function storageAvailable() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function validCoordinate(value: unknown): value is Coordinates {
  if (!value || typeof value !== 'object') return false;
  const coordinate = value as Partial<Coordinates>;
  return typeof coordinate.lat === 'number'
    && Number.isFinite(coordinate.lat)
    && Math.abs(coordinate.lat) <= 90
    && typeof coordinate.lng === 'number'
    && Number.isFinite(coordinate.lng)
    && Math.abs(coordinate.lng) <= 180;
}

function validStop(value: unknown): value is TripStop {
  if (!value || typeof value !== 'object') return false;
  const stop = value as Partial<TripStop>;
  return typeof stop.id === 'string'
    && typeof stop.address === 'string'
    && validCoordinate({ lat: stop.lat, lng: stop.lng });
}

function validSavedRoute(value: unknown): value is SavedDriverRoute {
  if (!value || typeof value !== 'object') return false;
  const route = value as Partial<SavedDriverRoute>;
  return route.version === 1
    && typeof route.driverSubject === 'string'
    && route.driverSubject.length > 0
    && typeof route.coachNumber === 'string'
    && route.coachNumber.length > 0
    && typeof route.officialRunKey === 'string'
    && route.officialRunKey.length > 0
    && typeof route.destinationAddress === 'string'
    && validCoordinate(route.destination)
    && Array.isArray(route.stops)
    && route.stops.every(validStop)
    && Array.isArray(route.routeGeometry)
    && route.routeGeometry.every(validCoordinate)
    && typeof route.savedAt === 'number'
    && typeof route.lastSuccessfulSyncAt === 'number'
    && typeof route.expiresAt === 'number';
}

function readRoutes(now = Date.now()): SavedDriverRoute[] {
  if (!storageAvailable()) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const routes = parsed.filter(validSavedRoute).filter((route) => route.expiresAt > now);
    if (routes.length !== parsed.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
    return routes;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function writeRoutes(routes: SavedDriverRoute[]) {
  if (!storageAvailable()) return;
  if (routes.length === 0) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
}

export function saveDriverOfflineRoute(input: {
  driverSubject: string;
  coachNumber: string;
  trip: LiveTrip;
  lastSuccessfulSyncAt: number;
  now?: number;
}): SavedDriverRoute | null {
  const now = input.now ?? Date.now();
  const coachNumber = input.coachNumber.trim().toUpperCase();
  const runKey = input.trip.officialRunKey?.trim();
  if (!input.driverSubject || !coachNumber || !runKey || !input.trip.destination) return null;
  if (!validCoordinate(input.trip.destination) || !input.trip.intermediateStops.every(validStop)) return null;

  const saved: SavedDriverRoute = {
    version: 1,
    driverSubject: input.driverSubject,
    coachNumber,
    officialRunKey: runKey,
    destinationAddress: input.trip.destinationAddress,
    ...(input.trip.destinationNote ? { destinationNote: input.trip.destinationNote } : {}),
    destination: { ...input.trip.destination },
    stops: input.trip.intermediateStops.map(({ id, address, note, lat, lng, eta: _eta }) => ({
      id,
      address,
      ...(note ? { note } : {}),
      lat,
      lng,
    })),
    routeGeometry: input.trip.routeGeometry.filter(validCoordinate).map((point) => ({ ...point })),
    savedAt: now,
    lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
    expiresAt: now + OFFLINE_ROUTE_MAX_AGE_MS,
  };

  // An authenticated driver may retain only the exact currently assigned run.
  // Replacing this driver's prior entry also clears an old coach assignment.
  const routes = readRoutes(now).filter((route) => route.driverSubject !== input.driverSubject);
  writeRoutes([...routes, saved]);
  return saved;
}

export function loadDriverOfflineRoute(
  driverSubject: string,
  coachNumber: string,
  now = Date.now(),
): SavedDriverRoute | null {
  if (!driverSubject || !coachNumber) return null;
  const normalizedCoach = coachNumber.trim().toUpperCase();
  return readRoutes(now).find((route) => (
    route.driverSubject === driverSubject && route.coachNumber === normalizedCoach
  )) ?? null;
}

export function clearDriverOfflineRoutes(driverSubject?: string) {
  if (!storageAvailable()) return;
  if (!driverSubject) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  writeRoutes(readRoutes().filter((route) => route.driverSubject !== driverSubject));
}
