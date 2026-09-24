import type { DisplayMode } from '@/lib/store';
import type { LiveTrip } from '@/providers/live-trip';

export function createPassengerDemoTrip(
  mode: DisplayMode = 'auto',
  now = new Date(),
): LiveTrip {
  const eta = new Date(now.getTime() + 75 * 60_000).toISOString();
  return {
    status: 'ready',
    destinationAddress: 'Port Authority Bus Terminal, New York, NY',
    destination: { lat: 40.7569, lng: -73.9903 },
    intermediateStops: [
      {
        id: 'monsey-demo-stop',
        address: 'Route 59 & Robert Pitt Drive, Monsey, NY',
        lat: 41.1112,
        lng: -74.0685,
        eta,
      },
    ],
    routeGeometry: [
      { lat: 41.1112, lng: -74.0685 },
      { lat: 40.9, lng: -74.02 },
      { lat: 40.7569, lng: -73.9903 },
    ],
    origin: { lat: 41.1112, lng: -74.0685 },
    currentLocation: { lat: 41.1112, lng: -74.0685 },
    totalDistanceMiles: 42,
    remainingDistanceMiles: 42,
    eta,
    speedMph: 0,
    startedAt: null,
    emergencyOverride: false,
    emergencyMessage: '',
    routeId: 'route-1',
    displayMode: mode,
    passengerLanguage: 'en',
    rotationIntervalSeconds: 15,
    arrivalSoundsEnabled: true,
    announcements: [{
      id: 'demo-welcome',
      title: 'Welcome Aboard',
      message: 'Thank you for choosing Monsey Trails. Please remain seated while the coach is moving.',
      active: true,
    }],
    chimeTestRequestedAt: null,
    passengerDisplays: [],
    locationVisibility: 'before_departure',
    scheduledDepartureAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}