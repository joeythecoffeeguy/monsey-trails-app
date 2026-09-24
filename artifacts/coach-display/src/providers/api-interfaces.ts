import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLiveTrip } from './live-trip';
import { formatPassengerDestination } from '@/lib/destination-label';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Stop {
  id: string;
  name: string;
  note?: string;
  location: Coordinates;
  /** Null when the routed response did not provide a stop arrival estimate. */
  eta: Date | null;
  scheduledArrival: Date | null;
  status: 'on-time' | 'delayed' | 'departed';
  isDestination: boolean;
}

export interface RouteData {
  id: string;
  origin: string;
  destination: string;
  stops: Stop[];
  totalDistanceMiles: number;
  distanceCoveredMiles: number;
  currentSpeedMph: number;
}

const MONSEY = { lat: 41.1112, lng: -74.0685 };
const MIDTOWN = { lat: 40.7549, lng: -73.9840 };
const BORO_PARK = { lat: 40.6350, lng: -73.9920 };
const WILLIAMSBURG = { lat: 40.7081, lng: -73.9571 };

function routeStops(origin: string, originLocation: Coordinates, destination: string, destinationLocation: Coordinates) {
  const now = Date.now();
  return [
    {
      id: 'origin',
      name: origin,
      location: originLocation,
      eta: new Date(now - 30 * 60 * 1000),
      scheduledArrival: new Date(now - 30 * 60 * 1000),
      status: 'departed' as const,
      isDestination: false,
    },
    {
      id: 'destination',
      name: destination,
      location: destinationLocation,
      eta: new Date(now + 45 * 60 * 1000),
      scheduledArrival: new Date(now + 45 * 60 * 1000),
      status: 'on-time' as const,
      isDestination: true,
    },
  ];
}

// Route choices shown to operators and used by the passenger display.
export const MOCK_ROUTES: Record<string, RouteData> = {
  'route-1': {
    id: 'route-1',
    origin: 'Monsey',
    destination: 'Midtown',
    totalDistanceMiles: 42,
    distanceCoveredMiles: 24,
    currentSpeedMph: 48,
    stops: routeStops('Monsey', MONSEY, 'Midtown', MIDTOWN),
  },
  'route-2': {
    id: 'route-2',
    origin: 'Monsey',
    destination: 'Boro Park',
    totalDistanceMiles: 51,
    distanceCoveredMiles: 29,
    currentSpeedMph: 45,
    stops: routeStops('Monsey', MONSEY, 'Boro Park', BORO_PARK),
  },
  'route-3': {
    id: 'route-3',
    origin: 'Monsey',
    destination: 'Williamsburg',
    totalDistanceMiles: 48,
    distanceCoveredMiles: 27,
    currentSpeedMph: 45,
    stops: routeStops('Monsey', MONSEY, 'Williamsburg', WILLIAMSBURG),
  },
  'route-4': {
    id: 'route-4',
    origin: 'Midtown',
    destination: 'Monsey',
    totalDistanceMiles: 42,
    distanceCoveredMiles: 18,
    currentSpeedMph: 48,
    stops: routeStops('Midtown', MIDTOWN, 'Monsey', MONSEY),
  },
  'route-5': {
    id: 'route-5',
    origin: 'Boro Park',
    destination: 'Monsey',
    totalDistanceMiles: 51,
    distanceCoveredMiles: 22,
    currentSpeedMph: 45,
    stops: routeStops('Boro Park', BORO_PARK, 'Monsey', MONSEY),
  },
  'route-6': {
    id: 'route-6',
    origin: 'Williamsburg',
    destination: 'Monsey',
    totalDistanceMiles: 48,
    distanceCoveredMiles: 21,
    currentSpeedMph: 45,
    stops: routeStops('Williamsburg', WILLIAMSBURG, 'Monsey', MONSEY),
  },
};

export interface WeatherData {
  tempF: number;
  feelsLikeF: number;
  humidityPercent: number;
  windMph: number;
  condition: string;
  icon: 'sun' | 'cloud' | 'rain' | 'snow' | 'storm';
  status: 'loading' | 'live' | 'error';
  updatedAt: Date;
  state: 'live' | 'stale' | 'offline';
}

export interface TrafficData {
  status: 'clear' | 'moderate' | 'heavy';
  delayMinutes: number;
  arrivalTime: Date | null;
  travelTimeMinutes: number | null;
  summary: string;
  road: string;
  updatedAt: Date;
  state: 'live' | 'stale' | 'offline';
}

interface TelemetrySnapshot {
  location: Coordinates | null;
  speedMph: number | null;
  connectivity: 'strong' | 'weak' | 'offline';
  lastUpdated: Date;
}
export function useGPSData(routeId: string) {
  const snapshot = useSyncExternalStore(subscribeTelemetry, () => telemetry, () => telemetry);
  const liveTrip = useLiveTrip();
  const baseRoute = MOCK_ROUTES[routeId] || MOCK_ROUTES['route-1'];
  const route = useMemo(() => {
    // Mounted displays receive the authoritative stop list through the
    // passenger pairing endpoint.  It is also present while a trip is ready
    // (and while passenger privacy has hidden telemetry), so do not require
    // running/ distance fields here: doing so silently selected MOCK_ROUTES
    // and reduced a multi-stop trip to its generic two-point route.
    if (liveTrip.intermediateStops.length > 0 || liveTrip.destination) {
      const eta = liveTrip.eta ? new Date(liveTrip.eta) : null;
      const destinationName = formatPassengerDestination(liveTrip.destinationAddress);
      const intermediateStops = liveTrip.intermediateStops.map((stop) => {
        // The API normally supplies these from the routed leg durations. Do not
        // manufacture evenly-spaced arrivals when a provider omits a leg.
        const parsedStopEta = stop.eta ? new Date(stop.eta) : null;
        const stopEta = parsedStopEta && Number.isFinite(parsedStopEta.getTime()) ? parsedStopEta : null;
        return {
          id: stop.id,
          name: formatPassengerDestination(stop.address),
          note: stop.note,
          location: { lat: stop.lat, lng: stop.lng },
          eta: stopEta,
          scheduledArrival: stopEta,
          status: 'on-time' as const,
          isDestination: false,
        };
      });
      const destinationStop = liveTrip.destination ? [{
        id: 'live-destination',
        name: destinationName,
        note: liveTrip.destinationNote,
        location: liveTrip.destination,
        eta,
        scheduledArrival: eta,
        status: 'on-time' as const,
        isDestination: true,
      }] : [];
      return {
        id: 'live-trip',
        origin: 'Current location',
        destination: destinationName,
        totalDistanceMiles: liveTrip.totalDistanceMiles ?? baseRoute.totalDistanceMiles,
        distanceCoveredMiles: liveTrip.totalDistanceMiles !== null && liveTrip.remainingDistanceMiles !== null
          ? Math.max(0, liveTrip.totalDistanceMiles - liveTrip.remainingDistanceMiles)
          : 0,
        currentSpeedMph: liveTrip.speedMph ?? snapshot.speedMph ?? 0,
        stops: [...intermediateStops, ...destinationStop],
      };
    }
    return {
      ...baseRoute,
      currentSpeedMph: snapshot.speedMph ?? baseRoute.currentSpeedMph,
    };
  }, [baseRoute, liveTrip, snapshot.speedMph]);

  const sharedLocation = liveTrip.locationVisibility === 'live' && liveTrip.status === 'running'
    ? liveTrip.currentLocation
    : null;
  const location = snapshot.location ?? sharedLocation ?? fallbackLocation(route);
  const locationStatus = snapshot.location || sharedLocation
    ? 'live' as const
    : snapshot.connectivity === 'offline'
      ? 'unavailable' as const
      : 'demo' as const;

  return {
    route,
    position: location,
    location,
    locationSource: snapshot.location || sharedLocation ? 'coach-gps' as const : 'route-estimate' as const,
    connectivity: snapshot.connectivity,
    locationStatus,
    lastUpdated: snapshot.lastUpdated,
  };
}

function weatherCodeToPresentation(code: number): Pick<WeatherData, 'condition' | 'icon'> {
  if (code === 0) return { condition: 'Clear', icon: 'sun' };
  if (code <= 3) return { condition: 'Partly cloudy', icon: 'cloud' };
  if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) {
    return { condition: 'Snow', icon: 'snow' };
  }
  if (code >= 95) return { condition: 'Thunderstorms', icon: 'storm' };
  if (code >= 51 && code <= 82) return { condition: 'Rain', icon: 'rain' };
  return { condition: 'Cloudy', icon: 'cloud' };
}

export function useWeatherData(location: Coordinates): WeatherData {
  const latKey = location.lat.toFixed(2);
  const lngKey = location.lng.toFixed(2);
  const cacheKey = `coach-weather-us:${latKey},${lngKey}`;
  const [weather, setWeather] = useState<WeatherData>(() => {
    const cached = typeof localStorage === 'undefined' ? null : localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Omit<WeatherData, 'updatedAt'> & { updatedAt: string };
        return { ...parsed, updatedAt: new Date(parsed.updatedAt), status: 'live', state: navigator.onLine ? 'stale' : 'offline' };
      } catch {
        localStorage.removeItem(cacheKey);
      }
    }
    return {
      tempF: 0,
      feelsLikeF: 0,
      humidityPercent: 0,
      windMph: 0,
      condition: 'Loading weather',
      icon: 'cloud',
      status: 'loading',
      updatedAt: new Date(0),
      state: navigator.onLine ? 'stale' : 'offline',
    };
  });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const params = new URLSearchParams({
          latitude: latKey,
          longitude: lngKey,
          current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
          temperature_unit: 'fahrenheit',
          wind_speed_unit: 'mph',
          timezone: 'auto',
        });
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
        const body = await response.json() as {
          current: {
            temperature_2m: number;
            apparent_temperature: number;
            relative_humidity_2m: number;
            weather_code: number;
            wind_speed_10m: number;
            time: string;
          };
        };
        const next: WeatherData = {
          tempF: Math.round(body.current.temperature_2m),
          feelsLikeF: Math.round(body.current.apparent_temperature),
          humidityPercent: Math.round(body.current.relative_humidity_2m),
          windMph: Math.round(body.current.wind_speed_10m),
          ...weatherCodeToPresentation(body.current.weather_code),
          status: 'live',
          updatedAt: new Date(body.current.time),
          state: 'live',
        };
        localStorage.setItem(cacheKey, JSON.stringify(next));
        if (active) setWeather(next);
      } catch {
        if (active) setWeather((current) => ({
          ...current,
          condition: current.updatedAt.getTime() ? current.condition : 'Weather temporarily unavailable',
          status: 'error',
          state: navigator.onLine ? 'stale' : 'offline',
        }));
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [cacheKey, latKey, lngKey]);

  return weather;
}

export function useTrafficData(routeId: string): TrafficData {
  const { route, location, connectivity, lastUpdated } = useGPSData(routeId);
  const liveTrip = useLiveTrip();
  const nextStop = route.stops.find((stop) => stop.status !== 'departed') ?? route.stops[route.stops.length - 1];
  const target = liveTrip.intermediateStops[0]
    ? { lat: liveTrip.intermediateStops[0].lat, lng: liveTrip.intermediateStops[0].lng }
    : liveTrip.destination ?? nextStop?.location;
  const trafficOriginLat = location?.lat.toFixed(3);
  const trafficOriginLng = location?.lng.toFixed(3);
  const [liveTraffic, setLiveTraffic] = useState<TrafficData | null>(null);

  useEffect(() => {
    if (liveTrip.status !== 'running' || !trafficOriginLat || !trafficOriginLng || !target) {
      setLiveTraffic(null);
      return;
    }
    let active = true;
    const refresh = async () => {
      const params = new URLSearchParams({
        originLat: trafficOriginLat,
        originLng: trafficOriginLng,
        destinationLat: target.lat.toString(),
        destinationLng: target.lng.toString(),
      });
      try {
        const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/traffic/route?${params}`, {
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) throw new Error(`Traffic provider returned ${response.status}`);
        const result = await response.json() as {
          trafficDelaySeconds: number;
          travelTimeSeconds: number;
          departureTime: string;
          arrivalTime: string | null;
        };
        const delayMinutes = Math.max(0, Math.round(result.trafficDelaySeconds / 60));
        const arrivalTime = result.arrivalTime ? new Date(result.arrivalTime) : null;
        const status: TrafficData['status'] = delayMinutes >= 10 ? 'heavy' : delayMinutes >= 4 ? 'moderate' : 'clear';
        const summary = status === 'clear'
          ? 'TomTom traffic is moving well. Arrival remains on schedule.'
          : status === 'heavy'
            ? `Live traffic is adding about ${delayMinutes} minutes to the journey.`
            : `Live traffic may add about ${delayMinutes} minutes to the journey.`;
        if (active) {
          setLiveTraffic({
            status,
            delayMinutes,
            arrivalTime: arrivalTime && Number.isFinite(arrivalTime.getTime()) ? arrivalTime : null,
            travelTimeMinutes: Math.max(1, Math.round(result.travelTimeSeconds / 60)),
            summary,
            road: `Approaching ${nextStop?.name ?? formatPassengerDestination(liveTrip.destinationAddress)}`,
            updatedAt: new Date(result.departureTime),
            state: 'live',
          });
        }
      } catch {
        if (active) {
          setLiveTraffic((current) => current ? {
            ...current,
            state: connectivity === 'offline' ? 'offline' : 'stale',
          } : null);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    liveTrip.status,
    liveTrip.destinationAddress,
    trafficOriginLat,
    trafficOriginLng,
    target?.lat,
    target?.lng,
    nextStop?.name,
    connectivity,
  ]);

  if (!liveTrip.destinationAddress) {
    return {
      status: 'clear',
      delayMinutes: 0,
      arrivalTime: null,
      travelTimeMinutes: null,
      summary: 'Travel conditions will appear after the operator enters a destination.',
      road: 'Waiting for destination',
      updatedAt: lastUpdated,
      state: connectivity === 'offline' ? 'offline' : 'live',
    };
  }
  if (liveTrip.status !== 'running') {
    return {
      status: 'clear',
      delayMinutes: 0,
      arrivalTime: null,
      travelTimeMinutes: null,
      summary: 'Live travel conditions will begin when the operator starts the trip.',
      road: `Destination: ${formatPassengerDestination(liveTrip.destinationAddress)}`,
      updatedAt: lastUpdated,
      state: connectivity === 'offline' ? 'offline' : 'live',
    };
  }

  return liveTraffic ?? {
    status: 'clear',
    delayMinutes: 0,
    arrivalTime: null,
    travelTimeMinutes: null,
    summary: 'Connecting to TomTom live traffic…',
    road: `Approaching ${nextStop?.name ?? formatPassengerDestination(liveTrip.destinationAddress)}`,
    updatedAt: lastUpdated,
    state: connectivity === 'offline' ? 'offline' : 'stale',
  };
}

function subscribeTelemetry(listener: () => void) {
  startTelemetry();
  telemetryListeners.add(listener);
  return () => telemetryListeners.delete(listener);
}

const telemetryListeners = new Set<() => void>();

let gpsStarted = false;

function publishTelemetry(next: Partial<TelemetrySnapshot>) {
  telemetry = { ...telemetry, ...next };
  telemetryListeners.forEach((listener) => listener());
}

function startTelemetry() {
  if (gpsStarted || typeof window === 'undefined') return;
  gpsStarted = true;

  window.addEventListener('online', () => publishTelemetry({ connectivity: telemetry.location ? 'strong' : 'weak' }));
  window.addEventListener('offline', () => publishTelemetry({ connectivity: 'offline' }));

  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    ({ coords, timestamp }) => publishTelemetry({
      location: { lat: coords.latitude, lng: coords.longitude },
      speedMph: coords.speed == null ? null : Math.max(0, Math.round(coords.speed * 2.23694)),
      connectivity: navigator.onLine ? 'strong' : 'offline',
      lastUpdated: new Date(timestamp),
    }),
    () => publishTelemetry({ connectivity: navigator.onLine ? 'weak' : 'offline' }),
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 12_000 },
  );
}

function fallbackLocation(route: RouteData): Coordinates {
  const activeStop = route.stops.find((stop) => stop.status !== 'departed');
  return activeStop?.location ?? route.stops[route.stops.length - 1].location;
}

let telemetry: TelemetrySnapshot = {
  location: null,
  speedMph: null,
  connectivity: typeof navigator !== 'undefined' && navigator.onLine ? 'weak' : 'offline',
  lastUpdated: new Date(),
};
