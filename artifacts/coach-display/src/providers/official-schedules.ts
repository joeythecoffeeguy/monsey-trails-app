export interface OfficialScheduleRun {
  id: string;
  routeCode: string;
  routeSymbol: string;
  secondarySymbol: string;
  direction: string;
  firstPickupTime: string;
  scheduledTime: string;
  arrivalTime: string | null;
  arrivalVerification?: 'verified' | 'unverified' | 'unavailable';
  durationMinutes: number;
  pickupDescription: string;
  dropoffDescription: string;
  displayKeys: Array<'B' | 'G' | 'H' | 'M' | 'P' | 'Q' | 'R' | 'X'>;
  pickupNote?: string;
  dropoffNote?: string;
  departureStatus: 'awaiting_departure' | 'on_time' | 'delayed' | 'live_estimate' | 'unavailable' | 'completed';
  delayMinutes: number | null;
  disruptions?: import('./live-trip').ServiceDisruption[];
}

export interface OfficialSchedule {
  source: string;
  fetchedAt: string;
  date: string;
  origin: { id: number; name: string };
  destination: { id: number; name: string };
  keyLegend: Array<{ key: string; meaning: string }>;
  runs: OfficialScheduleRun[];
}

export interface OfficialRunIdentity {
  line: number;
  origin: number;
  destination: number;
  date: string;
  runId: string;
}

export function createOfficialRunKey(identity: OfficialRunIdentity) {
  return `${identity.date}|${identity.line}|${identity.origin}|${identity.destination}|${identity.runId}`;
}

export const BUS_LINES = [
  { id: 1, name: 'New York Line' },
  { id: 3, name: 'Lakewood Express' },
  { id: 2, name: 'KJ Express' },
];

export const SERVICE_AREAS = [
  { id: 2, name: 'Monsey', lines: [1, 2], lat: 41.1112, lng: -74.0685 },
  { id: 1, name: 'New Square', lines: [1, 2], lat: 41.1396, lng: -74.0299 },
  { id: 3, name: 'Boro Park', lines: [1, 3], lat: 40.6343, lng: -73.9977 },
  { id: 4, name: 'Williamsburg', lines: [1], lat: 40.7033, lng: -73.9566 },
  { id: 5, name: 'Manhattan', lines: [1], lat: 40.7577, lng: -73.9787 },
  { id: 6, name: 'Wall Street', lines: [1], lat: 40.7075, lng: -74.0113 },
  { id: 7, name: 'Lakewood (Westgate)', lines: [3], lat: 40.0907, lng: -74.2446 },
  { id: 8, name: 'Lakewood (Sq. Kennedy)', lines: [3], lat: 40.0839, lng: -74.2046 },
  { id: 9, name: 'Flatbush', lines: [3], lat: 40.6214, lng: -73.9566 },
  { id: 10, name: 'Kiryas Yoel', lines: [2], lat: 41.3409, lng: -74.1679 },
  { id: 11, name: 'B&H', lines: [1], lat: 40.753106, lng: -73.995857 },
  { id: 12, name: 'Crown Heights', lines: [1], lat: 40.6694, lng: -73.9422 },
];

export interface ResolvedOfficialRoute {
  runId: string;
  routeCode: string;
  origin: { id: number; name: string };
  destination: { id: string; label: string; note?: string; lat: number; lng: number };
  points: Array<{ id: string; label: string; mapLabel: string; note?: string; lat: number; lng: number; kind: 'pickup' | 'dropoff' }>;
  stops: Array<{ id: string; label: string; mapLabel: string; note?: string; lat: number; lng: number; kind: 'pickup' | 'dropoff' }>;
}

export interface OfficialStopPreview {
  label: string;
  lat: number;
  lng: number;
  note?: string;
}

export interface OfficialRoutePoint {
  label: string;
  name: string;
  note?: string;
  lat: number;
  lng: number;
  timingOffsetMinutes?: number;
}

export interface OfficialRouteTemplate {
  points: OfficialRoutePoint[];
  source: string;
}

const RETURN_ROUTE_1 = relabel([
  { name: 'Route 59 & Route 45', lat: 41.108858, lng: -74.0426841 },
  { name: 'Route 59 at Evergreen Supermarket', lat: 41.1079204, lng: -74.063017 },
  { name: 'Monsey Boulevard & West Central Avenue', lat: 41.1121224, lng: -74.0612323 },
  { name: 'Monsey Boulevard & Maple Avenue', lat: 41.1155585, lng: -74.0618653 },
  { name: 'Maple Avenue & Phyllis Terrace', lat: 41.1160516, lng: -74.0671655 },
  { name: 'Route 306 & Wiener Drive', lat: 41.1263, lng: -74.0677 },
  { name: 'Route 306 & Viola Road', lat: 41.1352447, lng: -74.0658576 },
  { name: 'Viola Road & Union Road', lat: 41.1320805, lng: -74.0536982 },
  { name: 'New Square', lat: 41.1404518, lng: -74.035136 },
]);

const BORO_PARK_PICKUPS = relabel([
  { name: '18th Avenue & 49th Street', lat: 40.628542, lng: -73.981288 },
  { name: '17th Avenue & 49th Street', lat: 40.62978, lng: -73.983334 },
  { name: '16th Avenue & 49th Street', lat: 40.631241, lng: -73.985751 },
  { name: '15th Avenue & 49th Street', lat: 40.632558, lng: -73.988008 },
  { name: '14th Avenue & 49th Street', lat: 40.633931, lng: -73.990207 },
  { name: '13th Avenue & 49th Street', lat: 40.63529, lng: -73.992473 },
  { name: '12th Avenue & 49th Street', lat: 40.636566, lng: -73.994628 },
  { name: '11th Avenue & 49th Street', lat: 40.637898, lng: -73.996775 },
]);

export const MONSEY_ROUTE_POINTS: Record<string, OfficialRoutePoint[]> = {
  '1': [
    { label: 'A', name: 'Viola Road & Union Road', lat: 41.1323157, lng: -74.0542874, timingOffsetMinutes: -15 },
    { label: 'B', name: 'Route 306 & Viola Road', note: 'Across from Ohr Sameach', lat: 41.1338219, lng: -74.0667543 },
    { label: 'C', name: 'Route 306 & Wiener Drive', lat: 41.1263, lng: -74.0677 },
    { label: 'D', name: 'Maple Avenue nursing home', lat: 41.1158632, lng: -74.067946, timingOffsetMinutes: 0 },
    { label: 'E', name: 'Monsey Boulevard bus shelter', lat: 41.1158955, lng: -74.0620344 },
    { label: 'F', name: 'Monsey Boulevard & West Central', lat: 41.1121538, lng: -74.0613365 },
    { label: 'G', name: 'Amazing Savings bus shelter', lat: 41.1079204, lng: -74.063017 },
    { label: 'H', name: 'Route 59 & West Street', lat: 41.1082, lng: -74.0529 },
    { label: 'I', name: 'Route 59 & Route 45', lat: 41.1087272, lng: -74.042239 },
  ],
  '1P': [],
  '3': [],
  '3P': [],
  '4': [],
};

const NEW_SQUARE_PICKUPS = relabel([
  { name: 'Jackson Avenue & Cleveland Avenue', lat: 41.139656, lng: -74.032828 },
  { name: 'Jackson Avenue & Washington Avenue', lat: 41.1381882, lng: -74.0306377 },
  { name: 'Washington Avenue & Truman Avenue', lat: 41.1388185, lng: -74.029892 },
  { name: 'Washington Avenue & Bush Lane', lat: 41.1405509, lng: -74.0310561 },
  { name: 'Washington Avenue & Jackson Avenue', lat: 41.1406747, lng: -74.0327905 },
]);
export async function fetchOfficialSchedule(line: number, origin: number, destination: number, date: string) {
  const params = new URLSearchParams({ line: String(line), origin: String(origin), destination: String(destination), date });
  const response = await fetch(`/api/public-schedules/monsey-trails?${params}`, { cache: 'no-store' });
  const body = await response.json() as OfficialSchedule & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Could not load the official schedule.');
  return body;
}

export async function resolveOfficialRun(line: number, origin: number, destination: number, date: string, runId: string) {
  const response = await fetch('/api/public-schedules/monsey-trails/resolve-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line, origin, destination, date, runId }),
  });
  const body = await response.json() as ResolvedOfficialRoute & { error?: string; unresolved?: string[] };
  if (!response.ok) {
    const detail = body.unresolved?.length ? ` ${body.unresolved.join('; ')}` : '';
    throw new Error(`${body.error || 'Could not resolve the official route.'}${detail}`);
  }
  return body;
}

export async function resolveOfficialStop(label: string, areaId: number) {
  const response = await fetch('/api/public-schedules/monsey-trails/stop-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, areaId }),
  });
  const body = await response.json() as OfficialStopPreview & { error?: string };
  if (!response.ok) throw new Error(body.error || 'A map preview is not available for this stop.');
  return body;
}

const RETURN_ROUTE_7P = relabel([
  { name: 'Old Nyack Turnpike & South Madison Avenue', lat: 41.1013637, lng: -74.0476076 },
  { name: 'Route 59 at Evergreen Supermarket', lat: 41.1079204, lng: -74.063017 },
  { name: 'Monsey Park & Ride', lat: 41.1065904, lng: -74.0677434 },
  ...RETURN_ROUTE_1.slice(2),
]);

const MANHATTAN_PICKUPS = relabel([
  { name: '5th Avenue & 47th Street', lat: 40.756592, lng: -73.978751 },
  { name: '5th Avenue & 42nd Street', lat: 40.753348, lng: -73.981034 },
  { name: '7th Avenue & 42nd Street', lat: 40.756311, lng: -73.987403 },
  { name: '8th Avenue & 42nd Street', lat: 40.757191, lng: -73.989904 },
]);

const RETURN_ROUTE_1P = relabel([
  ...RETURN_ROUTE_1.slice(0, 2),
  { name: 'Monsey Park & Ride', lat: 41.1065904, lng: -74.0677434 },
  ...RETURN_ROUTE_1.slice(2),
]);

const WALL_STREET_PICKUPS = relabel([
  { name: 'Trinity Place & Exchange Alley', lat: 40.707875, lng: -74.012754 },
  { name: '6th Avenue & Spring Street', lat: 40.725672, lng: -74.003915 },
  { name: '6th Avenue & 23rd Street', lat: 40.743027, lng: -73.992644 },
]);

const WILLIAMSBURG_PICKUPS = relabel([
  { name: 'Bedford Avenue & Hewes Street', lat: 40.702845, lng: -73.959584 },
  { name: 'Bedford Avenue & Wilson Street', lat: 40.7053505, lng: -73.958891 },
]);

const WILLIAMSBURG_Q_PICKUPS = relabel([
  { name: 'Bedford Avenue & Wallabout Street', lat: 40.699718, lng: -73.957196 },
  ...WILLIAMSBURG_PICKUPS.map(({ name, note, lat, lng, timingOffsetMinutes }) => (
    { name, note, lat, lng, timingOffsetMinutes }
  )),
]);

function routeKey(run: Pick<OfficialScheduleRun, 'routeSymbol' | 'routeCode' | 'secondarySymbol'>) {
  return `${run.routeSymbol} ${run.secondarySymbol} ${run.routeCode}`.toUpperCase();
}

const ORIGIN_PICKUPS: Record<number, OfficialRoutePoint[]> = {
  1: NEW_SQUARE_PICKUPS,
  3: BORO_PARK_PICKUPS,
  4: WILLIAMSBURG_PICKUPS,
  5: MANHATTAN_PICKUPS,
  6: WALL_STREET_PICKUPS,
};

const RETURN_ROUTE_8 = relabel([
  { name: 'Maple Avenue & Route 45', lat: 41.1174431, lng: -74.044439 },
  { name: 'Maple Avenue & Twin Avenue', lat: 41.1171598, lng: -74.050292 },
  { name: 'Maple Avenue & Decatur Avenue', lat: 41.116996, lng: -74.05365 },
  { name: 'Monsey Boulevard bus shelter', lat: 41.1159358, lng: -74.062038 },
  { name: 'Monsey Boulevard & West Central Avenue', lat: 41.1121675, lng: -74.0613586 },
  { name: 'Route 59 & Robert Pitt Drive', lat: 41.1081337, lng: -74.0646416 },
  { name: 'Route 59 & Augusta Avenue', lat: 41.1081561, lng: -74.075436 },
  { name: 'Route 59 & Remsen Avenue', lat: 41.1094086, lng: -74.0807693 },
  { name: 'Grove Street & Saddle River Road', lat: 41.1109799, lng: -74.0709614 },
  { name: 'Route 306 & Maple Avenue', lat: 41.116215, lng: -74.0688627 },
  { name: 'Route 306 & Wiener Drive', lat: 41.1264187, lng: -74.0634646 },
  { name: 'Route 306 & Viola Road', note: 'Across from Ohr Sameach', lat: 41.1337779, lng: -74.0665569 },
  { name: 'Viola Road & Union Road', lat: 41.1320332, lng: -74.0535455 },
  { name: 'New Square', lat: 41.1404518, lng: -74.035136 },
]);

export function getOfficialRouteTemplate(
  originId: number,
  destinationId: number,
  run: Pick<OfficialScheduleRun, 'routeSymbol' | 'routeCode' | 'secondarySymbol'>,
): OfficialRouteTemplate | null {
  const key = routeKey(run);
  if (originId === 2) {
    const symbol = Object.keys(MONSEY_ROUTE_POINTS)
      .sort((a, b) => b.length - a.length)
      .find((candidate) => key.includes(candidate));
    const points = symbol ? MONSEY_ROUTE_POINTS[symbol] : undefined;
    return points?.length ? { points, source: ROUTES_SOURCE } : null;
  }

  const pickups = ORIGIN_PICKUPS[originId];
  if (!pickups?.length) return null;
  const originPickups = originId === 4 && key.includes('Q') ? WILLIAMSBURG_Q_PICKUPS : pickups;
  if (destinationId !== 2) return { points: originPickups, source: ROUTES_SOURCE };

  const dropoffs = key.includes('7P')
    ? RETURN_ROUTE_7P
    : key.includes('8')
      ? RETURN_ROUTE_8
      : key.includes('1P')
        ? RETURN_ROUTE_1P
        : RETURN_ROUTE_1;
  return { points: relabel([...originPickups.slice(1), ...dropoffs]), source: ROUTES_SOURCE };
}

function relabel(points: Omit<OfficialRoutePoint, 'label'>[]): OfficialRoutePoint[] {
  return points.map((point, index) => ({ ...point, label: String.fromCharCode(65 + index) }));
}

const ROUTES_SOURCE = 'https://www.monseytrails.com/routes';
