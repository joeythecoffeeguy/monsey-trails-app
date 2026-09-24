import { fetchTomTomRoute } from "./tomtom-routing";

export type TrafficRoutePoint = { lat: number; lng: number };

export type TrafficAwareRoute = {
  distanceMeters: number;
  travelTimeSeconds: number;
  noTrafficTravelTimeSeconds: number;
  trafficDelaySeconds: number;
  departureTime: string;
  arrivalTime: string;
  legDurationSeconds: number[];
  geometry: TrafficRoutePoint[];
  source: "tomtom-routing" | "tomtom-flow";
};

type FlowSample = {
  currentTravelTime?: number;
  freeFlowTravelTime?: number;
  currentSpeed?: number;
  freeFlowSpeed?: number;
  confidence?: number;
  roadClosure?: boolean;
};

const ROUTING_TIMEOUT_MS = 12_000;
const FLOW_SAMPLE_TIMEOUT_MS = 8_000;
const TRAFFIC_ROUTE_CACHE_TTL_MS = 30_000;
const TRAFFIC_ROUTE_CACHE_LIMIT = 200;
const trafficRouteCache = new Map<string, {
  expiresAt: number;
  value: Promise<TrafficAwareRoute>;
}>();

function radians(degrees: number) {
  return degrees * Math.PI / 180;
}

function distanceMeters(a: TrafficRoutePoint, b: TrafficRoutePoint) {
  const latDistance = radians(b.lat - a.lat);
  const lngDistance = radians(b.lng - a.lng);
  const haversine = Math.sin(latDistance / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngDistance / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function evenlySpacedRouteSamples(
  geometry: TrafficRoutePoint[],
  sampleCount: number,
) {
  if (geometry.length < 2 || sampleCount <= 0) return [];
  const cumulative = [0];
  for (let index = 1; index < geometry.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + distanceMeters(geometry[index - 1], geometry[index]);
  }
  const totalDistance = cumulative.at(-1) ?? 0;
  if (totalDistance <= 0) return [geometry[0]];
  return Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const targetDistance = totalDistance * (sampleIndex + 0.5) / sampleCount;
    let geometryIndex = cumulative.findIndex(value => value >= targetDistance);
    if (geometryIndex < 0) geometryIndex = geometry.length - 1;
    return geometry[geometryIndex];
  });
}

export function trafficDurationMultiplier(samples: FlowSample[]) {
  const ratios = samples.flatMap(sample => {
    if ((sample.confidence ?? 0) < 0.5) return [];
    if (sample.roadClosure) return [4];
    const travelTimeRatio = sample.currentTravelTime
      && sample.freeFlowTravelTime
      && sample.currentTravelTime > 0
      && sample.freeFlowTravelTime > 0
      ? sample.currentTravelTime / sample.freeFlowTravelTime
      : null;
    const speedRatio = sample.currentSpeed
      && sample.freeFlowSpeed
      && sample.currentSpeed > 0
      && sample.freeFlowSpeed > 0
      ? sample.freeFlowSpeed / sample.currentSpeed
      : null;
    const ratio = travelTimeRatio ?? speedRatio;
    return ratio && Number.isFinite(ratio) ? [Math.min(4, Math.max(1, ratio))] : [];
  });
  if (ratios.length < 3) return null;
  return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

function tomTomRoutingUrl(points: TrafficRoutePoint[], apiKey: string) {
  const locations = points.map(point => `${point.lat},${point.lng}`).join(":");
  const params = new URLSearchParams({
    key: apiKey,
    traffic: "true",
    routeType: "fastest",
    travelMode: "bus",
    computeTravelTimeFor: "all",
    routeRepresentation: "polyline",
  });
  return `https://api.tomtom.com/routing/1/calculateRoute/${locations}/json?${params}`;
}

async function fetchTomTomRouting(points: TrafficRoutePoint[], apiKey: string): Promise<TrafficAwareRoute> {
  const response = await fetchTomTomRoute(tomTomRoutingUrl(points, apiKey), ROUTING_TIMEOUT_MS);
  const body = await response.json() as {
    routes?: Array<{
      summary?: {
        lengthInMeters?: number;
        travelTimeInSeconds?: number;
        noTrafficTravelTimeInSeconds?: number;
        trafficDelayInSeconds?: number;
        departureTime?: string;
        arrivalTime?: string;
      };
      legs?: Array<{
        summary?: { travelTimeInSeconds?: number };
        points?: Array<{ latitude?: number; longitude?: number }>;
      }>;
    }>;
  };
  const route = body.routes?.[0];
  const summary = route?.summary;
  const legs = route?.legs;
  if (!summary || !legs || legs.length !== points.length - 1
    || typeof summary.travelTimeInSeconds !== "number") {
    throw new Error("TomTom routing returned an incomplete route");
  }
  const legDurationSeconds = legs.map(leg => leg.summary?.travelTimeInSeconds);
  if (legDurationSeconds.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    throw new Error("TomTom routing returned invalid leg times");
  }
  const geometry = legs.flatMap((leg, index) => (leg.points ?? [])
    .slice(index === 0 ? 0 : 1)
    .flatMap(point => (
      typeof point.latitude === "number" && typeof point.longitude === "number"
        ? [{ lat: point.latitude, lng: point.longitude }]
        : []
    )));
  if (geometry.length < 2) throw new Error("TomTom routing returned no geometry");
  const departureTime = summary.departureTime ?? new Date().toISOString();
  const arrivalTime = summary.arrivalTime
    ?? new Date(new Date(departureTime).getTime() + summary.travelTimeInSeconds * 1_000).toISOString();
  const noTrafficTravelTimeSeconds = summary.noTrafficTravelTimeInSeconds ?? summary.travelTimeInSeconds;
  return {
    distanceMeters: summary.lengthInMeters ?? 0,
    travelTimeSeconds: summary.travelTimeInSeconds,
    noTrafficTravelTimeSeconds,
    trafficDelaySeconds: Math.max(
      0,
      summary.trafficDelayInSeconds ?? 0,
      summary.travelTimeInSeconds - noTrafficTravelTimeSeconds,
    ),
    departureTime,
    arrivalTime,
    legDurationSeconds: legDurationSeconds as number[],
    geometry,
    source: "tomtom-routing",
  };
}

async function fetchOsrmRoute(points: TrafficRoutePoint[]) {
  const coordinates = points.map(point => `${point.lng},${point.lat}`).join(";");
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
    { signal: AbortSignal.timeout(ROUTING_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`Road routing returned ${response.status}`);
  const body = await response.json() as {
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: { coordinates?: Array<[number, number]> };
      legs?: Array<{ duration?: number }>;
    }>;
  };
  const route = body.routes?.[0];
  const geometry = route?.geometry?.coordinates?.map(([lng, lat]) => ({ lat, lng })) ?? [];
  const legDurationSeconds = route?.legs?.map(leg => leg.duration) ?? [];
  if (!route || typeof route.duration !== "number" || geometry.length < 2
    || legDurationSeconds.length !== points.length - 1
    || legDurationSeconds.some(value => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error("Road routing returned an incomplete route");
  }
  return {
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration,
    legDurationSeconds: legDurationSeconds as number[],
    geometry,
  };
}

async function fetchFlowSample(point: TrafficRoutePoint, apiKey: string): Promise<FlowSample | null> {
  const params = new URLSearchParams({
    point: `${point.lat},${point.lng}`,
    unit: "MPH",
    openLr: "false",
    key: apiKey,
  });
  const response = await fetch(
    `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json?${params}`,
    { signal: AbortSignal.timeout(FLOW_SAMPLE_TIMEOUT_MS) },
  );
  if (!response.ok) return null;
  const body = await response.json() as { flowSegmentData?: FlowSample };
  return body.flowSegmentData ?? null;
}

async function fetchTomTomFlowEstimate(
  points: TrafficRoutePoint[],
  apiKey: string,
): Promise<TrafficAwareRoute> {
  const roadRoute = await fetchOsrmRoute(points);
  const sampleCount = Math.min(12, Math.max(6, Math.ceil(roadRoute.distanceMeters / 3_000)));
  const samplePoints = evenlySpacedRouteSamples(roadRoute.geometry, sampleCount);
  const settled = await Promise.allSettled(samplePoints.map(point => fetchFlowSample(point, apiKey)));
  const samples = settled.flatMap(result => (
    result.status === "fulfilled" && result.value ? [result.value] : []
  ));
  const multiplier = trafficDurationMultiplier(samples);
  if (multiplier === null) throw new Error("TomTom flow returned insufficient live traffic coverage");
  const travelTimeSeconds = Math.round(roadRoute.durationSeconds * multiplier);
  const departure = new Date();
  return {
    distanceMeters: roadRoute.distanceMeters,
    travelTimeSeconds,
    noTrafficTravelTimeSeconds: roadRoute.durationSeconds,
    trafficDelaySeconds: Math.max(0, travelTimeSeconds - roadRoute.durationSeconds),
    departureTime: departure.toISOString(),
    arrivalTime: new Date(departure.getTime() + travelTimeSeconds * 1_000).toISOString(),
    legDurationSeconds: roadRoute.legDurationSeconds.map(seconds => Math.round(seconds * multiplier)),
    geometry: roadRoute.geometry,
    source: "tomtom-flow",
  };
}

async function fetchTrafficAwareRouteUncached(
  points: TrafficRoutePoint[],
  apiKey: string,
): Promise<TrafficAwareRoute> {
  try {
    return await fetchTomTomRouting(points, apiKey);
  } catch {
    return fetchTomTomFlowEstimate(points, apiKey);
  }
}

export async function fetchTrafficAwareRoute(
  points: TrafficRoutePoint[],
  apiKey: string,
): Promise<TrafficAwareRoute> {
  if (points.length < 2) throw new Error("At least two route points are required");
  const cacheKey = points
    .map(point => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`)
    .join(":");
  const cached = trafficRouteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = fetchTrafficAwareRouteUncached(points, apiKey);
  trafficRouteCache.set(cacheKey, {
    expiresAt: Date.now() + TRAFFIC_ROUTE_CACHE_TTL_MS,
    value,
  });
  void value.catch(() => {
    if (trafficRouteCache.get(cacheKey)?.value === value) trafficRouteCache.delete(cacheKey);
  });
  if (trafficRouteCache.size > TRAFFIC_ROUTE_CACHE_LIMIT) {
    trafficRouteCache.delete(trafficRouteCache.keys().next().value!);
  }
  return value;
}