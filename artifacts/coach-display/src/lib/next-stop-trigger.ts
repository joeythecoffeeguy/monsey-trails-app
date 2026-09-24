export const HAVERSINE_MILES = 3958.8;
export const STOP_COMPLETION_RADIUS_MILES = 0.01;

export function getDistanceMiles(
  coord1: { lat: number; lng: number },
  coord2: { lat: number; lng: number }
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(coord2.lat - coord1.lat);
  const dLng = toRad(coord2.lng - coord1.lng);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(coord1.lat)) *
      Math.cos(toRad(coord2.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
      
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return HAVERSINE_MILES * c;
}

export function parseEtaSeconds(eta: string | null, now: number): number | null {
  if (!eta) return null;
  const date = new Date(eta);
  if (isNaN(date.getTime())) return null;
  return (date.getTime() - now) / 1000;
}

export function shouldTriggerNextStop(
  tripStatus: 'idle' | 'ready' | 'running' | 'stopped',
  currentLocation: { lat: number; lng: number } | null,
  nextLocation: { lat: number; lng: number } | null,
  eta: string | null,
  now: number = Date.now()
): boolean {
  if (tripStatus !== 'running') return false;
  if (!currentLocation || !nextLocation) return false;

  const distanceMiles = getDistanceMiles(currentLocation, nextLocation);
  if (distanceMiles <= 0.5) return true;

  if (eta) {
    const seconds = parseEtaSeconds(eta, now);
    if (seconds !== null && seconds >= 0 && seconds <= 120) return true;
  }

  return false;
}

export function getNextStopPhase(
  currentLocation: { lat: number; lng: number } | null,
  nextLocation: { lat: number; lng: number } | null,
  eta: string | null,
  now: number = Date.now()
): 'approaching' | 'arriving' {
  if (!currentLocation || !nextLocation) return 'approaching';
  
  const distanceMiles = getDistanceMiles(currentLocation, nextLocation);
  if (distanceMiles <= 0.1) return 'arriving';
  
  if (eta) {
    const seconds = parseEtaSeconds(eta, now);
    if (seconds !== null && seconds >= 0 && seconds <= 30) return 'arriving';
  }
  
  return 'approaching';
}

export function shouldAutomaticallyCompleteStop(
  tripStatus: 'idle' | 'ready' | 'running' | 'stopped',
  currentLocation: { lat: number; lng: number } | null,
  nextLocation: { lat: number; lng: number } | null,
  speedMph: number | null,
): boolean {
  if (tripStatus !== 'running' || !currentLocation || !nextLocation) return false;
  if (speedMph !== null && speedMph > 10) return false;
  return getDistanceMiles(currentLocation, nextLocation) <= STOP_COMPLETION_RADIUS_MILES;
}
