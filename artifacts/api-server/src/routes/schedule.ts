import { Router, type IRouter } from "express";
import { db, liveTripsTable, scheduleStopOverridesTable, type LiveTripRow } from "@workspace/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { locationVisibility } from "../lib/trip-privacy";
import { officialAssignmentPriority } from "../lib/official-run-assignment";
import { extractPassengerStopNote, formatPassengerStopLabel } from "@workspace/passenger-stop-label";
import { activeServiceDisruptions } from "../lib/service-disruptions";
import { repairMissingWesternLongitude } from "../lib/route-coordinates";
import { fetchTrafficAwareRoute } from "../lib/traffic-routing";

const router: IRouter = Router();
const SOURCE_URL = "https://www.monseytrails.com";
const CACHE_TTL_MS = 30_000;
const VERIFIED_RUN_TTL_MS = 5 * 60_000;
const MAX_OFFICIAL_STOPS = 24;
const JOURNEY_TRAFFIC_TTL_MS = 30_000;
const JOURNEY_STALE_TTL_MS = 5 * 60_000;
const JOURNEY_CACHE_LIMIT = 100;

interface CachedSchedule {
  expiresAt: number;
  value: unknown;
}

const cache = new Map<string, CachedSchedule>();
const scheduleInFlight = new Map<string, Promise<ReturnType<typeof normalizeSchedule>>>();
const verifiedRunCache = new Map<string, { expiresAt: number; value: ResolvedOfficialRun }>();
const journeyTrafficCache = new Map<string, {
  createdAt: number;
  value: TrafficResult;
}>();
const journeyTrafficInFlight = new Map<string, Promise<TrafficResult>>();
let journeyCacheGeneration = 0;

type OfficialStop = {
  id: string;
  label: string;
  rawLabel?: string;
  address?: string;
  note?: string;
  mapLabel: string;
  lat: number;
  lng: number;
  kind: "pickup" | "dropoff";
  scheduledAt: string | null;
  areaId?: number;
};

export type ResolvedOfficialRun = {
  runKey: string;
  routeCode: string;
  originName: string;
  destinationName: string;
  serviceDate: string;
  scheduledDepartureAt: string | null;
  scheduledArrivalAt: string | null;
  arrivalVerification?: "verified" | "unverified" | "unavailable";
  trafficDepartureAt: string | null;
  stops: OfficialStop[];
};

type TrafficResult = {
  routeGeometry: Array<{ lat: number; lng: number }>;
  legDurationSeconds: number[];
  updatedAt: string;
};

type JourneyLiveTrip = Pick<
  LiveTripRow,
  "status" | "retiredAt" | "ownerSubject" | "officialRunKey" | "scheduledDepartureAt"
  | "completedAt" | "currentLat" | "currentLng" | "locationUpdatedAt" | "intermediateStops" | "updatedAt"
>;

export function isFreshLiveJourneyTrip(row: JourneyLiveTrip | null, now = Date.now()) {
  return Boolean(
    row
    && locationVisibility(row, now) === "live"
    && row.status === "running"
    && row.currentLat !== null
    && row.currentLng !== null
    && row.locationUpdatedAt !== null
    && now - row.locationUpdatedAt.getTime() <= 90_000
    && now >= row.locationUpdatedAt.getTime(),
  );
}

export function remainingOfficialJourneyStops<T extends { id: string }>(
  stops: T[],
  remainingStopIds: string[],
) {
  const remaining = new Set(remainingStopIds);
  return stops.filter((stop, index) => remaining.has(stop.id) || index === stops.length - 1);
}

function appendLiveDestination(
  stops: OfficialStop[],
  trip: Pick<LiveTripRow, "destinationLat" | "destinationLng" | "destinationAddress">,
) {
  if (
    typeof trip.destinationLat !== "number"
    || !Number.isFinite(trip.destinationLat)
    || typeof trip.destinationLng !== "number"
    || !Number.isFinite(trip.destinationLng)
  ) return stops;
  const id = `destination:${trip.destinationLat}:${trip.destinationLng}`;
  // A running trip's persisted intermediate list is authoritative for waypoints,
  // but it intentionally does not contain the final destination. Add that endpoint
  // here so a direct (zero-waypoint) trip still gets a current -> destination leg.
  // Remove an endpoint with the same generated id first so retries/reconciliations
  // can never expose the final destination twice.
  const withoutDestination = stops.filter(stop => stop.id !== id);
  return [
    ...withoutDestination,
    {
      id,
      label: trip.destinationAddress,
      address: trip.destinationAddress,
      mapLabel: "",
      lat: trip.destinationLat,
      lng: trip.destinationLng,
      kind: "dropoff" as const,
      scheduledAt: null,
    },
  ];
}

function comparableStopLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function scheduleStopKey(areaId: number, label: string) {
  return `${areaId}:${comparableStopLabel(label)}`;
}

export function applyStopOverride<T extends { lat: number; lng: number; label: string }>(
  stop: T,
  override: { address?: string | null; lat: number; lng: number } | null,
) {
  // Coordinates are operational data; the passenger-facing canonical label is
  // audited source data and must never be replaced by an administrator's
  // geocoder result.
  return override ? { ...stop, lat: override.lat, lng: override.lng } : stop;
}

export function reconcilePersistedJourneyStopIds<
  T extends { id: string; label: string; lat: number; lng: number },
  P extends { id: string; address: string; lat: number; lng: number },
>(officialStops: T[], persistedStops: P[]) {
  const unused = new Set(persistedStops);
  return officialStops.map(stop => {
    const persisted = [...unused].find(candidate => candidate.id === stop.id)
      ?? [...unused].find(candidate => milesBetween(stop, candidate) <= 0.03)
      ?? [...unused].find(candidate =>
        comparableStopLabel(candidate.address) === comparableStopLabel(stop.label));
    if (!persisted) return stop;
    unused.delete(persisted);
    return { ...stop, id: persisted.id };
  });
}

export function accumulateJourneyEtas(
  startAt: number,
  stopIds: string[],
  legDurationSeconds: number[],
  includeStartingStop = false,
  notBeforeByStopId: ReadonlyMap<string, number> = new Map(),
) {
  if (!Number.isFinite(startAt) || legDurationSeconds.length !== stopIds.length - (includeStartingStop ? 1 : 0)) {
    throw new Error("Journey legs do not match the ordered stops.");
  }
  const values = new Map<string, string>();
  let at = startAt;
  let stopIndex = 0;
  if (includeStartingStop && stopIds.length) {
    at = Math.max(at, notBeforeByStopId.get(stopIds[0]) ?? -Infinity);
    values.set(stopIds[0], new Date(at).toISOString());
    stopIndex = 1;
  }
  for (const seconds of legDurationSeconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Journey leg time is invalid.");
    at += seconds * 1_000;
    at = Math.max(at, notBeforeByStopId.get(stopIds[stopIndex]) ?? -Infinity);
    values.set(stopIds[stopIndex], new Date(at).toISOString());
    stopIndex += 1;
  }
  return values;
}

const SERVICE_AREAS: Record<number, { name: string; searchArea: string; lat: number; lng: number }> = {
  1: { name: "New Square", searchArea: "New Square, New York", lat: 41.1396, lng: -74.0299 },
  2: { name: "Monsey", searchArea: "Monsey, New York", lat: 41.1112, lng: -74.0685 },
  3: { name: "Boro Park", searchArea: "Borough Park, Brooklyn, New York", lat: 40.6343, lng: -73.9977 },
  4: { name: "Williamsburg", searchArea: "Williamsburg, Brooklyn, New York", lat: 40.7033, lng: -73.9566 },
  5: { name: "Manhattan", searchArea: "Manhattan, New York", lat: 40.7577, lng: -73.9787 },
  6: { name: "Wall Street", searchArea: "Financial District, New York", lat: 40.7075, lng: -74.0113 },
  7: { name: "Lakewood (Westgate)", searchArea: "Westgate, Lakewood, New Jersey", lat: 40.0907, lng: -74.2446 },
  8: { name: "Lakewood (Sq. Kennedy)", searchArea: "Squankum Road and Kennedy Boulevard, Lakewood, New Jersey", lat: 40.0839, lng: -74.2046 },
  9: { name: "Flatbush", searchArea: "Flatbush, Brooklyn, New York", lat: 40.6214, lng: -73.9566 },
  10: { name: "Kiryas Yoel", searchArea: "Kiryas Joel, New York", lat: 41.3409, lng: -74.1679 },
  11: { name: "B&H", searchArea: "34th Street and 9th Avenue, New York", lat: 40.753106, lng: -73.995857 },
  12: { name: "Crown Heights", searchArea: "Crown Heights, Brooklyn, New York", lat: 40.6694, lng: -73.9422 },
};

export function validScheduleQuery(query: Record<string, unknown>) {
  const line = Number(query.line);
  const origin = Number(query.origin);
  const destination = Number(query.destination);
  const date = String(query.date ?? "");
  if (![1, 2, 3].includes(line) || !Number.isInteger(origin) || origin < 1
    || !Number.isInteger(destination) || destination < 1 || origin === destination
    || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { line, origin, destination, date };
}

export function normalizeSchedule(body: any, date: string) {
  const runs = Array.isArray(body?.schedule) ? body.schedule : [];
  const origin = { id: Number(body?.origin_id), name: String(body?.origin ?? "") };
  const destination = { id: Number(body?.destination_id), name: String(body?.destination ?? "") };
  const baseIds = runs.map((run: any) => String(run?.schedule_busroute_id ?? run?.busroute?.id ?? ""));
  const duplicateBaseIds = new Set(
    baseIds.filter((id: string) => id && baseIds.filter((candidate: string) => candidate === id).length > 1),
  );
  return {
    source: "monseytrails.com",
    fetchedAt: new Date().toISOString(),
    date,
    origin,
    destination,
    keyLegend: SCHEDULE_KEY_LEGEND,
    runs: runs.map((run: any, index: number) => {
      const baseId = baseIds[index];
      const departure = String(run?.first_time || run?.time || "");
      // Upstream IDs identify a route definition, not necessarily a departure.
      // Preserve the old ID when it is unambiguous, but make each duplicate
      // deterministic across endpoint calls and counterpart route lookups.
      const id = duplicateBaseIds.has(baseId)
        ? `${baseId}~${publishedClockIdentity(departure)}`
        : baseId;
      const normalized = {
        id,
        routeCode: String(run?.busroute?.route_code ?? ""),
        routeSymbol: String(run?.busroute?.route_symbol ?? ""),
        secondarySymbol: String(run?.busroute?.route_symbol2 ?? ""),
        direction: String(run?.busroute?.direction ?? ""),
        firstPickupTime: String(run?.first_time ?? ""),
        scheduledTime: String(run?.time ?? ""),
        arrivalTime: String(run?.arrival ?? ""),
        arrivalVerification: publishedArrivalVerification(date, run?.arrival, scheduledDepartureInstant(date, String(run?.first_time || run?.time || ""))),
        durationMinutes: Number(run?.duration ?? 0),
        pickupDescription: String(run?.busroute?.description ?? ""),
        dropoffDescription: String(run?.busroute?.description2 ?? ""),
        departureStatus: "awaiting_departure" as const,
        delayMinutes: null as number | null,
      };
      return scheduleRunWithUpstreamIdentity({
        ...normalized,
        displayKeys: displayedScheduleKeys(normalized, origin.id, destination.id),
      }, run?.busroute?.id);
    }),
  };
}

function publishedClockIdentity(value: string) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!match) return "unknown";
  return `${String(Number(match[1]) % 24).padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

export const SCHEDULE_KEY_LEGEND = [
  { key: "B", meaning: "Goes to Boro Park." },
  { key: "G", meaning: "NYC stop at 34th Street between 9th and 10th Avenues only." },
  { key: "H", meaning: "Goes to Williamsburg." },
  { key: "M", meaning: "Goes to Midtown; drops off along 5th Avenue from 46th to 23rd Street." },
  { key: "P", meaning: "Also goes to the new Park & Ride." },
  { key: "Q", meaning: "Bedford Avenue & Wallabout Street is served 10 minutes before the scheduled time." },
  { key: "R", meaning: "Picks up and drops off at B&H Photo." },
  { key: "X", meaning: "Express to/from Boro Park." },
] as const;

const SCHEDULE_KEY_ORDER = SCHEDULE_KEY_LEGEND.map(item => item.key);
const SCHEDULE_KEY_SET = new Set<string>(SCHEDULE_KEY_ORDER);

/**
 * Public rider keys are separate from routeSymbol/secondarySymbol/routeCode because
 * those upstream operational fields are also used to resolve a coach's stop pattern.
 */
export function displayedScheduleKeys(
  run: Pick<ScheduleRun, "routeCode" | "routeSymbol" | "secondarySymbol" | "pickupDescription" | "dropoffDescription">,
  originId: number,
  destinationId: number,
) {
  const keys = new Set<string>();
  const addPublished = (value: string) => {
    for (const character of value.toUpperCase()) {
      if (SCHEDULE_KEY_SET.has(character)) keys.add(character);
    }
  };

  // Symbols are dedicated upstream display fields and may contain combined keys.
  addPublished(run.routeSymbol);
  addPublished(run.secondarySymbol);

  // Combined upstream route codes place display letters after their numeric route
  // identity (for example N1PBGH). A prefix such as B2 is route identity, not key B.
  const routeCodeSuffix = /^[A-Z]*\d+([A-Z]+)$/i.exec(run.routeCode.trim())?.[1] ?? "";
  addPublished(routeCodeSuffix);

  const endpointIds = new Set([originId, destinationId]);
  if (endpointIds.has(3)) keys.add("B");
  if (endpointIds.has(4)) keys.add("H");
  if (endpointIds.has(11)) keys.add("R");

  return SCHEDULE_KEY_ORDER.filter(key => keys.has(key));
}

function authoritativeScheduleFingerprint(schedule: ReturnType<typeof normalizeSchedule>) {
  return JSON.stringify({
    date: schedule.date,
    origin: schedule.origin,
    destination: schedule.destination,
    runs: schedule.runs,
  });
}

function invalidateScheduleDerivedCaches() {
  verifiedRunCache.clear();
  journeyTrafficCache.clear();
  journeyTrafficInFlight.clear();
  journeyCacheGeneration += 1;
}

export function invalidateScheduleStopCaches() {
  invalidateScheduleDerivedCaches();
}

type ScheduleRun = {
  id: string;
  routeCode: string;
  routeSymbol: string;
  secondarySymbol: string;
  direction: string;
  firstPickupTime: string;
  scheduledTime: string;
  arrivalTime: string;
  arrivalVerification?: "verified" | "unverified" | "unavailable";
  durationMinutes: number;
  pickupDescription: string;
  dropoffDescription: string;
  displayKeys?: string[];
  departureStatus: "awaiting_departure" | "on_time" | "delayed" | "live_estimate" | "unavailable" | "completed";
  delayMinutes: number | null;
  /** Upstream route definition ID. Kept non-enumerable so the public response stays unchanged. */
  upstreamRouteId?: string;
};

type OfficialRunQuery = { line: number; origin: number; destination: number; date: string };

function scheduleRunWithUpstreamIdentity(run: ScheduleRun, upstreamRouteId: unknown) {
  Object.defineProperty(run, "upstreamRouteId", {
    value: String(upstreamRouteId ?? ""),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return run;
}
type PublicDepartureTrip = Pick<
  LiveTripRow,
  "officialRunKey" | "status" | "retiredAt" | "completedAt" | "startedAt"
  | "scheduledDepartureAt" | "locationUpdatedAt" | "ownerSubject"
  | "currentLat" | "currentLng" | "intermediateStops" | "destinationLat" | "destinationLng"
>;

export function createOfficialScheduleRunKey(
  query: { line: number; origin: number; destination: number; date: string },
  runId: string,
) {
  return `${query.date}|${query.line}|${query.origin}|${query.destination}|${runId}`;
}

export function isVerifiedSharedOriginRun(
  first: Pick<ScheduleRun, "id" | "routeCode" | "direction" | "arrivalTime" | "upstreamRouteId">,
  second: Pick<ScheduleRun, "id" | "routeCode" | "direction" | "arrivalTime" | "upstreamRouteId">,
) {
  // Read-only samples from the official endpoint on 2026-09-20 and 2026-09-22 showed the
  // same non-null schedule_busroute_id, busroute.id, route_code, direction, and arrival
  // under origins 1 and 2, while origin-2-only IDs (for example 62251 and 62213 on
  // 2026-09-22 to Manhattan) had no origin-1 record. Null schedule IDs are never aliases.
  return Boolean(
    first.id
    && first.id === second.id
    && first.upstreamRouteId
    && first.upstreamRouteId === second.upstreamRouteId
    && first.routeCode
    && first.routeCode === second.routeCode
    && first.direction === second.direction
    && first.arrivalTime === second.arrivalTime,
  );
}

export function verifiedSharedOriginRunKeys(
  query: OfficialRunQuery,
  first: Pick<ScheduleRun, "id" | "routeCode" | "direction" | "arrivalTime" | "upstreamRouteId">,
  second: Pick<ScheduleRun, "id" | "routeCode" | "direction" | "arrivalTime" | "upstreamRouteId">,
) {
  if (
    query.line !== 1
    || ![1, 2].includes(query.origin)
    || ![3, 4, 5].includes(query.destination)
    || !isVerifiedSharedOriginRun(first, second)
  ) return [createOfficialScheduleRunKey(query, first.id)];
  return [1, 2].map(origin => createOfficialScheduleRunKey({ ...query, origin }, first.id));
}

export function isVerifiedManhattanBoroParkThroughRun(
  first: Pick<ScheduleRun, "id" | "routeCode" | "direction" | "scheduledTime" | "arrivalTime">,
  second: Pick<ScheduleRun, "id" | "routeCode" | "direction" | "scheduledTime" | "arrivalTime">,
) {
  return Boolean(
    first.id
    && first.id === second.id
    && first.routeCode
    && first.routeCode === second.routeCode
    && first.direction === "outgoing"
    && second.direction === "outgoing"
    && first.scheduledTime === second.scheduledTime
    && first.arrivalTime === second.arrivalTime,
  );
}

export function orderedManhattanBoroParkDropoffs(
  manhattanDropoffDescription: string,
  boroParkDropoffDescription: string,
  lineId = 1,
) {
  return [
    ...auditedRegionalStopLines(manhattanDropoffDescription, 5)
      .map(line => ({ line, areaId: 5, kind: "dropoff" as const })),
    ...(auditedBoroParkStopLines(boroParkDropoffDescription, lineId, "dropoff")
      ?? parseStopDescription(boroParkDropoffDescription))
      .map(line => ({ line, areaId: 3, kind: "dropoff" as const })),
  ];
}

type ThroughRunPair = { manhattanRun: ScheduleRun; boroParkRun: ScheduleRun };

async function findManhattanBoroParkThroughRun(
  query: OfficialRunQuery,
  run: ScheduleRun,
): Promise<ThroughRunPair | null> {
  if (query.line !== 1 || ![1, 2].includes(query.origin) || ![3, 5].includes(query.destination)) {
    return null;
  }
  const counterpartDestination = query.destination === 5 ? 3 : 5;
  try {
    const counterpartSchedule = await fetchOfficialSchedule({
      ...query,
      destination: counterpartDestination,
    });
    const counterpartRun = (counterpartSchedule.runs as ScheduleRun[])
      .find(candidate => candidate.id === run.id);
    if (!counterpartRun || !isVerifiedManhattanBoroParkThroughRun(run, counterpartRun)) return null;
    return query.destination === 5
      ? { manhattanRun: run, boroParkRun: counterpartRun }
      : { manhattanRun: counterpartRun, boroParkRun: run };
  } catch {
    return null;
  }
}

export function orderedSharedOriginStopLines(
  newSquarePickupDescription: string,
  monseyPickupDescription: string,
  dropoffDescription: string,
) {
  const monseyLines = parseStopDescription(monseyPickupDescription);
  const monseyLabels = new Set(monseyLines.map(comparableStopLabel));
  return [
    ...parseStopDescription(newSquarePickupDescription)
      .filter(line => !monseyLabels.has(comparableStopLabel(line)))
      .map(line => ({ line, areaId: 1, kind: "pickup" as const })),
    ...monseyLines.map(line => ({ line, areaId: 2, kind: "pickup" as const })),
    ...parseStopDescription(dropoffDescription).map(line => ({ line, areaId: 0, kind: "dropoff" as const })),
  ];
}

async function resolveRunIdentity(query: OfficialRunQuery, runId: string) {
  const schedule = await fetchOfficialSchedule(query);
  const matches = (schedule.runs as ScheduleRun[]).filter(candidate => candidate.id === runId || (
    !runId.includes("~") && candidate.id.split("~", 1)[0] === runId
  ));
  if (matches.length > 1) {
    throw Object.assign(new Error("That legacy run ID matches multiple published departures; refresh the schedule and select the exact departure."), { status: 409 });
  }
  const run = matches[0];
  if (!run) throw Object.assign(new Error("That run is no longer in the published schedule."), { status: 404 });
  if (query.line !== 1 || ![1, 2].includes(query.origin) || ![3, 4, 5].includes(query.destination) || !run.id) {
    return { schedule, run, canonicalQuery: query, canonicalSchedule: schedule, canonicalRun: run, shared: false };
  }
  const counterpartQuery = { ...query, origin: query.origin === 1 ? 2 : 1 };
  const counterpartSchedule = await fetchOfficialSchedule(counterpartQuery);
  const counterpart = (counterpartSchedule.runs as ScheduleRun[]).find(candidate =>
    candidate.id === run.id && isVerifiedSharedOriginRun(run, candidate));
  if (!counterpart) {
    return { schedule, run, canonicalQuery: query, canonicalSchedule: schedule, canonicalRun: run, shared: false };
  }
  if (query.origin === 1) {
    return { schedule, run, canonicalQuery: query, canonicalSchedule: schedule, canonicalRun: run, shared: true };
  }
  return {
    schedule,
    run,
    canonicalQuery: counterpartQuery,
    canonicalSchedule: counterpartSchedule,
    canonicalRun: counterpart,
    shared: true,
  };
}

async function equivalentOfficialRunKeys(query: OfficialRunQuery, runId: string) {
  const identity = await resolveRunIdentity(query, runId);
  const keys = identity.shared
    ? verifiedSharedOriginRunKeys(identity.canonicalQuery, identity.canonicalRun, identity.run)
    : [createOfficialScheduleRunKey(identity.canonicalQuery, runId)];
  return { identity, keys: [...new Set(keys)] };
}

export async function resolveEquivalentOfficialRunKeys(runKey: string) {
  return (await resolveOfficialRunAlias(runKey)).keys;
}

export async function resolveOfficialRunAlias(runKey: string) {
  const [date, line, origin, destination, runId, extra] = runKey.split("|");
  const query = validScheduleQuery({ date, line, origin, destination });
  if (!query || !runId || extra) return { keys: [runKey], physicalDepartureAt: null };
  try {
    const resolved = await equivalentOfficialRunKeys(query, runId);
    const canonical = resolved.identity.canonicalRun;
    return {
      keys: resolved.keys,
      physicalDepartureAt: earliestPublishedRunDeparture(query.date, canonical),
    };
  } catch {
    return { keys: [runKey], physicalDepartureAt: null };
  }
}

export function publicDepartureStatus(
  run: ScheduleRun,
  serviceDate: string,
  trip: PublicDepartureTrip | null,
  now = Date.now(),
  liveArrivalAt: Date | null = null,
): Pick<ScheduleRun, "departureStatus" | "delayMinutes"> {
  if (trip?.retiredAt || trip?.completedAt || trip?.status === "stopped") {
    return { departureStatus: "completed", delayMinutes: null };
  }
  const activelyStarted = trip?.status === "running" && Boolean(trip.startedAt);
  if (!activelyStarted || !trip) {
    return { departureStatus: "awaiting_departure", delayMinutes: null };
  }
  if (trip.scheduledDepartureAt && now < trip.scheduledDepartureAt.getTime()) {
    return { departureStatus: "awaiting_departure", delayMinutes: null };
  }
  if (locationVisibility(trip, now) !== "live") return { departureStatus: "unavailable", delayMinutes: null };
  const locationTime = trip.locationUpdatedAt?.getTime() ?? NaN;
  if (!Number.isFinite(locationTime) || locationTime > now || now - locationTime > 90_000) {
    return { departureStatus: "unavailable", delayMinutes: null };
  }
  if (!liveArrivalAt || !Number.isFinite(liveArrivalAt.getTime())) {
    return { departureStatus: "unavailable", delayMinutes: null };
  }
  const departure = scheduledDepartureInstant(serviceDate, run.firstPickupTime || run.scheduledTime);
  const baseline = publishedArrivalInstant(serviceDate, run.arrivalTime, departure);
  if (!baseline) return { departureStatus: "live_estimate", delayMinutes: null };
  const delayMinutes = Math.max(0, Math.ceil((liveArrivalAt.getTime() - baseline.getTime()) / 60_000));
  return {
    departureStatus: delayMinutes <= 2 ? "on_time" : "delayed",
    delayMinutes,
  };
}

function liveStatusRoute(
  runKey: string,
  trip: PublicDepartureTrip,
  now: number,
) {
  const locationTime = trip.locationUpdatedAt?.getTime() ?? NaN;
  if (
    trip.status !== "running"
    || !trip.startedAt
    || locationVisibility(trip, now) !== "live"
    || !Number.isFinite(locationTime)
    || locationTime > now
    || now - locationTime > 90_000
    || trip.currentLat === null
    || trip.currentLng === null
    || trip.destinationLat === null
    || trip.destinationLng === null
  ) return null;
  const remaining = [
    ...trip.intermediateStops,
    {
      id: `destination:${trip.destinationLat}:${trip.destinationLng}`,
      lat: trip.destinationLat,
      lng: trip.destinationLng,
    },
  ];
  const points = [{ lat: trip.currentLat, lng: trip.currentLng }, ...remaining.map(({ lat, lng }) => ({ lat, lng }))];
  return {
    cacheKey: liveTrafficCacheKey(runKey, { lat: trip.currentLat, lng: trip.currentLng }, remaining),
    points,
  };
}

function liveTrafficCacheKey(
  runKey: string,
  current: { lat: number; lng: number },
  remaining: Array<{ id: string; lat: number; lng: number }>,
) {
  const locationKey = `${current.lat.toFixed(5)},${current.lng.toFixed(5)}`;
  const stopKeys = remaining.map((stop, index) =>
    index === remaining.length - 1 ? `destination:${stop.lat}:${stop.lng}` : stop.id,
  );
  return `${runKey}:live:${locationKey}:${stopKeys.join(",")}`;
}

async function mapBounded<T, R>(values: T[], limit: number, mapValue: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapValue(values[index]);
    }
  }));
  return results;
}

async function enrichScheduleDepartureStatuses(
  query: { line: number; origin: number; destination: number; date: string },
  schedule: ReturnType<typeof normalizeSchedule>,
) {
  if (!schedule.runs.length) return schedule;
  const runs = schedule.runs as ScheduleRun[];
  const aliases = await Promise.all(runs.map(async run => {
    try {
      const resolved = await equivalentOfficialRunKeys(query, run.id);
      const canonical = resolved.identity.canonicalRun;
      return {
        keys: resolved.keys,
        physicalDepartureAt: earliestPublishedRunDeparture(query.date, canonical),
      };
    } catch {
      return { keys: [createOfficialScheduleRunKey(query, run.id)], physicalDepartureAt: null };
    }
  }));
  const runKeys = [...new Set(aliases.flatMap(alias => alias.keys))];
  const rows = await db.select().from(liveTripsTable)
    .where(inArray(liveTripsTable.officialRunKey, runKeys))
    .orderBy(desc(officialAssignmentPriority), desc(liveTripsTable.updatedAt));
  const now = Date.now();
  const enrichedRuns = await mapBounded(runs, 3, async run => {
    const runKey = createOfficialScheduleRunKey(query, run.id);
    const alias = aliases[runs.indexOf(run)];
    const equivalentKeys = alias.keys;
    const equivalentSet = new Set(equivalentKeys);
    const storedTrip = rows.find(row => row.officialRunKey && equivalentSet.has(row.officialRunKey)) ?? null;
    const trip = storedTrip && alias.physicalDepartureAt
      ? { ...storedTrip, scheduledDepartureAt: alias.physicalDepartureAt }
      : storedTrip;
    const route = trip ? liveStatusRoute(runKey, trip, now) : null;
    let liveArrivalAt: Date | null = null;
    if (route) {
      const traffic = await fetchJourneyTraffic(route.cacheKey, route.points);
      if (traffic && !traffic.stale) {
        const durationSeconds = traffic.legDurationSeconds.reduce((sum, seconds) => sum + seconds, 0);
        liveArrivalAt = new Date(now + durationSeconds * 1_000);
      }
    }
    return {
      ...run,
      ...publicDepartureStatus(run, query.date, trip, now, liveArrivalAt),
    };
  });
  return {
    ...schedule,
    runs: enrichedRuns,
  };
}

export function parseStopDescription(description: string) {
  return description
    .split(/\r?\n|<br\s*\/?>/i)
    .map((line) => line
      .replace(/^\s*(?:stop\s*)?\d+\s*[:.)-]\s*/i, "")
      .replace(/^\s*\d+\s*\\\.\s*/i, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter((line) => line.length >= 4);
}

/**
 * Expands the operator's compound corridor descriptions only where the published
 * route page and public stop/landmark data establish the actual ordered stops.
 * All other text stays intact and must match the verified registry below.
 */
export function auditedRegionalStopLines(description: string, areaId: number) {
  const text = normalizedStopEvidence(description);
  const variants: Record<number, Record<string, string[]>> = {
    4: {
      [normalizedStopEvidence("On Bedford Avenue between Hewes and Hooper (613 Bedford Ave) and continues to Bedford Avenue between Wilson and Taylor.")]:
        ["Bedford Avenue & Hewes Street", "Bedford Avenue & Wilson Street"],
      [normalizedStopEvidence("Starts 10 minutes before schedule on Bedford Avenue corner Wallabout street, at schedule time on Bedford between Hewes and Hooper and continues to Bedford Ave. between Wilson and Taylor.")]:
        ["Bedford Avenue & Wallabout Street", "Bedford Avenue & Hewes Street", "Bedford Avenue & Wilson Street"],
      [normalizedStopEvidence("Drops off on Bedford Avenue at Hewes Street, and Bedford Avenue between Wilson and Taylor.")]:
        ["Bedford Avenue & Hewes Street", "Bedford Avenue & Wilson Street"],
      // The PDF's non-Q wording names the verified Taylor stop directly. Keep
      // this separate from the older "between Wilson and Taylor" source
      // variant, whose published label is Wilson.
      [normalizedStopEvidence("Drops off on Bedford Avenue at Hewes Street, and Bedford Avenue at Taylor Street.")]:
        ["Bedford Avenue & Hewes Street", "Bedford Avenue & Taylor Street"],
      [normalizedStopEvidence("On Bedford Avenue between Hewes and Hooper and continues to Bedford Avenue at Taylor Street.")]:
        ["Bedford Avenue & Hewes Street", "Bedford Avenue & Taylor Street"],
      [normalizedStopEvidence("If the schedule is marked with a Q the bus will drop off at Bedford and Wallabout Street, Bedford by Hewes Street and continue to Bedford Ave. between Wilson and Taylor.")]:
        ["Bedford Avenue & Wallabout Street", "Bedford Avenue & Hewes Street", "Bedford Avenue & Wilson Street"],
      [normalizedStopEvidence("Drops off on Bedford Avenue at Hewes Street, and Bedford Avenue between Wilson and Taylor. If the schedule is marked with a Q the bus will drop off at Bedford and Wallabout Street, Bedford by Hewes Street and continue to Bedford Ave. between Wilson and Taylor.")]:
        ["Bedford Avenue & Wallabout Street", "Bedford Avenue & Hewes Street", "Bedford Avenue & Wilson Street"],
      [normalizedStopEvidence("go down Lee Avenue & onto Wallabout Street")]:
        ["Bedford Avenue & Wallabout Street"],
      [normalizedStopEvidence("The bus will go down Lee Avenue and turn right onto Wallabout Street.")]:
        ["Bedford Avenue & Wallabout Street"],
    },
    5: {
      [normalizedStopEvidence("Drops off on 5th Ave corner 47st, 45st, 42st, 23st.")]:
        ["5th Avenue & 47th Street", "5th Avenue & 45th Street", "5th Avenue & 42nd Street", "5th Avenue & 23rd Street"],
    },
    8: {
      [normalizedStopEvidence("Picks up at Squankum and Kennedy, ON Kennedy across Astor.")]:
        ["Kennedy Boulevard & Squankum Road"],
    },
    9: {
      [normalizedStopEvidence("On Coney Island and Ave. N, and on Conery Island corner Ave. J")]:
        ["Coney Island Avenue & Avenue N", "Coney Island Avenue & Avenue J"],
      [normalizedStopEvidence("At Coney Island and Ave. J, & at Coney Island corner Ave. N")]:
        ["Coney Island Avenue & Avenue J", "Coney Island Avenue & Avenue N"],
    },
    10: {
      [normalizedStopEvidence("Drops off on Bakertown Rd. front of Park and Ride, left on Israel Zupnik, left on acres left on forest, right on schunnemunk Rd, right on quickway left on van buren, right on Garfield.")]:
        ["Kiryas Joel Park & Ride", "Garfield Road bus stop"],
    },
  };
  const audited = variants[areaId]?.[text];
  if (audited) return [...audited];
  return parseStopDescription(description);
}

function normalizedStopEvidence(value: string) {
  return value.toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(?:avenue|ave|street|st|road|rd|drive|dr|boulevard|blvd|parkway|pkwy)\b\.?/g, " ")
    .replace(/^\s*(?:starts?\s+(?:on|by)|picks?\s+up\s+(?:on|at)|on|at)\s+/g, "")
    .replace(/\b(?:in front of|across from|across)\b/g, " ")
    .replace(/\bcorner\b/g, "&")
    .replace(/\band\b/g, "&")
    .replace(/[^a-z0-9&]+/g, " ")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s+/g, " ")
    .trim();
}

const NEW_YORK_BORO_PARK_CORRIDOR = [
  "18th Avenue & 50th Street",
  "17th Avenue & 49th Street",
  "16th Avenue & 49th Street",
  "15th Avenue & 49th Street",
  "14th Avenue & 49th Street",
  "13th Avenue & 49th Street",
  "12th Avenue & 49th Street",
  "11th Avenue & 49th Street",
  "Fort Hamilton Parkway & 49th Street",
] as const;

const LAKEWOOD_BORO_PARK_CORRIDOR = [
  "18th Avenue & 49th Street",
  ...NEW_YORK_BORO_PARK_CORRIDOR.slice(1),
] as const;

const BORO_PARK_50TH_DROP_OFF_CORRIDOR = [
  "50th Street & Fort Hamilton Parkway",
  "50th Street & 11th Avenue",
  "50th Street & New Utrecht Avenue",
  "50th Street & 13th Avenue",
  "50th Street & 14th Avenue",
  "50th Street & 15th Avenue",
  "50th Street & 16th Avenue",
  "50th Street & 17th Avenue",
  "50th Street & 18th Avenue — drop-off",
] as const;

/**
 * Expands the website's misleading one-line Boro Park shorthand into the
 * audited public bus stops used by navigation, passenger displays and summaries.
 */
export function auditedBoroParkStopLines(
  description: string,
  lineId?: number,
  kind: "pickup" | "dropoff" = "pickup",
) {
  const lines = parseStopDescription(description);
  if (lines.length !== 1) return null;
  const text = lines[0].toLowerCase()
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bparkway\b/g, "pkwy")
    .replace(/[&,/()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const mentions18th = /\b18th\s+ave\b|\b18th\b/.test(text);
  const mentions49th = /\b49th\s+st\b|\b49th\b/.test(text);
  const mentions50th = /\b50th\s+st\b|\b50th\b/.test(text);
  const mentionsFortHamilton = /\bfort\s+hamilton(?:\s+pkwy)?\b/.test(text);
  const routeLanguage = /\b(?:along|between|through|from|starts?|continues?|every\s+bus\s+stop|by)\b/.test(text);
  // The published Boro Park destination wording is a distinct, directional
  // corridor. Never infer it from line identity: NY pickup also mentions
  // 18th/50th, but remains the rider-confirmed 49th Street route.
  const narrativeIs50thDropoff = /\balong\s+50th\b/.test(text)
    && (mentionsFortHamilton || /\bto\s+18th\b/.test(text));
  const is50thDropoff = mentions50th && (
    kind === "dropoff"
      ? mentionsFortHamilton || /\bto\s+18th(?:\s+ave)?\b|\b18th(?:\s+ave)?\s+to\b/.test(text)
      : narrativeIs50thDropoff
  );
  if (is50thDropoff) return [...BORO_PARK_50TH_DROP_OFF_CORRIDOR];
  const isWebsiteShorthand = /\balong\s+50th(?:\s+st)?\b/.test(text)
    || (lineId !== 3 && mentions18th && mentions50th)
    || (mentions18th && routeLanguage && (mentions49th || mentions50th || mentionsFortHamilton))
    || (mentions49th && mentionsFortHamilton && routeLanguage);
  if (!isWebsiteShorthand) return null;
  return [...(lineId === 3 ? LAKEWOOD_BORO_PARK_CORRIDOR : NEW_YORK_BORO_PARK_CORRIDOR)];
}

/** Release audit uses only verified aliases; a geocoder result is never evidence. */
export function unresolvedPublishedRunStops(
  run: Pick<ScheduleRun, "pickupDescription" | "dropoffDescription">,
  query: Pick<OfficialRunQuery, "line" | "origin" | "destination">,
  approvedOverrideKeys: ReadonlySet<string> = new Set(),
) {
  const lines = (description: string, areaId: number, kind: "pickup" | "dropoff") =>
    areaId === 3
      ? auditedBoroParkStopLines(description, query.line, kind) ?? parseStopDescription(description)
      : auditedRegionalStopLines(description, areaId);
  return [
    ...lines(run.pickupDescription, query.origin, "pickup")
      .map(label => ({ areaId: query.origin, kind: "pickup" as const, label })),
    ...lines(run.dropoffDescription, query.destination, "dropoff")
      .map(label => ({ areaId: query.destination, kind: "dropoff" as const, label })),
  ].filter(stop => !knownStop(stop.label, stop.areaId)
    && !approvedOverrideKeys.has(scheduleStopKey(stop.areaId, stop.label)));
}

export function passengerStopSummary(description: string, areaId: number, lineId?: number) {
  const auditedBoroParkStops = areaId === 3 ? auditedBoroParkStopLines(description, lineId, "pickup") : null;
  if (auditedBoroParkStops) return auditedBoroParkStops.join(" • ");
  return auditedRegionalStopLines(description, areaId)
    .map(line => {
      const verified = knownStop(line, areaId);
      return formatPassengerStopLabel(line, { verifiedLabel: verified?.passengerLabel });
    })
    .filter(Boolean)
    .join(" • ");
}

export function passengerStopNotes(description: string, areaId: number, lineId?: number) {
  if (areaId === 3 && auditedBoroParkStopLines(description, lineId, "pickup")) {
    return lineId === 3
      ? "Starts at 18th Avenue & 49th Street, then serves every bus stop along 49th Street through Fort Hamilton Parkway"
      : "Starts at 18th Avenue & 50th Street, then serves every bus stop along 49th Street through Fort Hamilton Parkway";
  }
  const notes = parseStopDescription(description).map(line => {
    const verified = knownStop(line, areaId);
    const label = formatPassengerStopLabel(line, { verifiedLabel: verified?.passengerLabel });
    return extractPassengerStopNote(line, label);
  }).filter((note): note is string => Boolean(note));
  return notes.length ? notes.join(" • ") : undefined;
}

function publishedTimeFromLine(line: string) {
  const match = line.match(/\b((?:0?\d|1[0-2]):[0-5]\d\s*(?:a\.?m\.?|p\.?m\.?)|(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)\b/i);
  if (!match) return null;
  const value = match[1].replace(/\./g, "").replace(/\s+/g, " ").toUpperCase();
  const twelveHour = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(value);
  if (!twelveHour) return value.padStart(5, "0");
  let hour = Number(twelveHour[1]) % 12;
  if (twelveHour[3] === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${twelveHour[2]}:00`;
}

export function publishedArrivalVerification(date: string, value: string | null | undefined, departure: Date | null): "verified" | "unverified" | "unavailable" {
  if (!value?.trim()) return "unavailable";
  return publishedArrivalInstant(date, value, departure) ? "verified" : "unverified";
}

export function publishedArrivalInstant(date: string, value: string, departure: Date | null): Date | null {
  if (!value || !departure) return null;
  if (value.includes("T")) {
    // Dated arrivals are evidence, not a time-of-day template. Never move their date.
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
    const direct = new Date(value);
    if (!Number.isFinite(direct.getTime()) || direct < departure) return null;
    const parts = (instant: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(instant).map(p => [p.type, p.value]));
    const arrival = parts(direct);
    const start = parts(departure);
    const startDate = `${start.year}-${start.month}-${start.day}`;
    const arrivalDate = `${arrival.year}-${arrival.month}-${arrival.day}`;
    const nextDay = new Date(`${startDate}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const rollsOver = `${arrival.hour}:${arrival.minute}:${arrival.second}` < `${start.hour}:${start.minute}:${start.second}`;
    const expectedDate = rollsOver ? nextDay.toISOString().slice(0, 10) : startDate;
    return arrivalDate === expectedDate ? direct : null;
  }
  const sameDay = scheduledDepartureInstant(date, value);
  if (!sameDay) return null;
  if (departure && sameDay.getTime() < departure.getTime()) {
    const nextDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(departure.getTime() + 24 * 60 * 60_000));
    return scheduledDepartureInstant(nextDate, value);
  }
  return sameDay;
}

export function publishedStopInstant(
  date: string,
  line: string,
  index: number,
  stopCount: number,
  run: { firstPickupTime: string; scheduledTime: string; arrivalTime: string },
) {
  const firstPickup = scheduledDepartureInstant(date, run.firstPickupTime);
  const nominal = scheduledDepartureInstant(date, run.scheduledTime || run.firstPickupTime);
  const trafficDeparture = firstPickup ?? nominal;
  const explicit = publishedTimeFromLine(line);
  if (explicit) return publishedArrivalInstant(date, explicit, trafficDeparture);
  if (index === 0 && firstPickup) return firstPickup;
  if (/\b(?:at|on)\s+schedule(?:d)?(?:\s+time)?\b/i.test(line)) return nominal;
  const relative = line.match(/\b(\d{1,3})\s*(?:minutes?|mins?\.?)\s*(?:prior\s+to|before)\b/i);
  if (relative && nominal) return new Date(nominal.getTime() - Number(relative[1]) * 60_000);
  if (index === stopCount - 1) return publishedArrivalInstant(date, run.arrivalTime, trafficDeparture);
  return null;
}

function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function knownStop(line: string, areaId: number) {
  const text = line.toLowerCase();
  const exact = (...phrases: string[]) => phrases.some(phrase => (
    normalizedStopEvidence(line) === normalizedStopEvidence(phrase)
  ));
  if (
    [5, 11].includes(areaId)
    && exact(
      "34th Street & 9th Avenue",
      "34th St & 9th Ave",
      "9th Avenue & 34th Street",
      "B&H",
      "Drops off in Manhattan at 34th St & and 9th Ave.",
      "Drops off on 9Th Ave and 34Th street",
      "This bus drops off in Manhattan at 34th St. and 9th Ave only then continues to Boro park",
    )
  ) {
    return {
      lat: 40.753106,
      lng: -73.995857,
      label: line,
      passengerLabel: "B&H — 34th Street & 9th Avenue",
    };
  }
  if (areaId === 1 && exact(
    "Jackson Avenue & Washington Avenue",
    "Along Washington Avenue & Jackson Avenue",
    "Along Jackson Avenue & Washington Avenue",
    "Along Washington Avenue, Right on Jackson Avenue, left on Washington Avenue to end of Route.",
    "Beginning of Route, Right on Jackson Avenue, left on Washington Avenue goes along Washington Avenue, leaves New Square.",
  )) {
    return {
      lat: 41.1381882,
      lng: -74.0306377,
      label: line,
      passengerLabel: "Jackson Avenue & Washington Avenue",
    };
  }
  // Landmark-only stops intentionally remain landmarks: official map pins do not
  // establish a boarding intersection. See ../docs/passenger-stop-evidence.md.
  const aliases = areaId === 2 || areaId === 1 ? [
    { matches: ["route 59 corner route 45", "route 59 corner 45", "route 59 & route 45", "food fare", "route 59 corner 45 in front of the mobil gas station", "route 59 corner 45 in front of the mobil gas station (food fare)"], lat: 41.1087272, lng: -74.042239, passengerLabel: "Route 59 & Route 45" },
    // Monsey Trails GTFS route 8 designated drop-off coordinates.
    { matches: ["maple avenue & route 45", "route 45 & maple avenue"], lat: 41.117476, lng: -74.044177, passengerLabel: "Maple Avenue & Route 45" },
    { matches: ["maple avenue & twin avenue", "twin avenue & maple avenue"], lat: 41.117161, lng: -74.050228, passengerLabel: "Maple Avenue & Twin Avenue" },
    { matches: ["maple avenue & decatur avenue", "decatur avenue & maple avenue"], lat: 41.116979, lng: -74.054589, passengerLabel: "Maple Avenue & Decatur Avenue" },
    { matches: ["route 59 & remsen avenue", "remsen avenue & route 59"], lat: 41.10911412, lng: -74.08070326, passengerLabel: "Route 59 & Remsen Avenue" },
    { matches: ["grove street & saddle river road", "saddle river road & grove street"], lat: 41.110945, lng: -74.071434, passengerLabel: "Grove Street & Saddle River Road" },
    { matches: ["route 59 across evergreen", "route 59 across evergreen supermarket", "route 59 at amazing savings"], lat: 41.107, lng: -74.0644, passengerLabel: "Route 59 at Amazing Savings" },
    // TOR GTFS stop TOWN, Town Square - Amazing Savings.
    { matches: ["evergreen supermarket", "amazing savings", "kosher castle", "kosher kastle", "in front of amazing savings at the bus shelter", "(evergreen) in front of amazing savings at the bus shelter"], lat: 41.107, lng: -74.0644, passengerLabel: "Amazing Savings" },
    { matches: ["new park and ride", "park & ride", "park and ride"], lat: 41.1064718, lng: -74.0684144, passengerLabel: "Monsey Park & Ride" },
    { matches: ["monsey blvd corner west central", "monsey blvd across west central", "monsey boulevard & west central", "on monsey blvd across west central (bus shelter)"], lat: 41.1121538, lng: -74.0613365, passengerLabel: "Monsey Boulevard & West Central Avenue" },
    { matches: ["monsey blvd at the bus shelter", "monsey boulevard bus shelter"], lat: 41.1158955, lng: -74.0620344, passengerLabel: "Monsey Boulevard — bus shelter" },
    { matches: ["monsey blvd corner maple", "monsey boulevard & maple"], lat: 41.1164, lng: -74.0622, passengerLabel: "Monsey Boulevard & Maple Avenue" },
    // Official Monsey Trails Route 8 KML pin; this is not the unrelated TOR MOMA stop.
    { matches: ["route 306 & maple avenue", "maple avenue & route 306", "306 & maple avenue"], lat: 41.116215, lng: -74.0688627, passengerLabel: "Route 306 & Maple Avenue" },
    { matches: ["maple ave corner phillies", "maple ave corner phillies terrace", "maple avenue & phillies", "maple avenue & phyllis"], lat: 41.116078, lng: -74.07049, passengerLabel: "Maple Avenue & Phyllis Terrace" },
    { matches: ["306 corner wiener", "306 & wiener", "route 306 & wiener"], lat: 41.1263, lng: -74.0677, passengerLabel: "Route 306 & Wiener Drive" },
    // TOR GTFS stop VI306, Viola Rd & Hwy 306.
    { matches: ["306 corner viola", "306 and viola", "route 306 & viola", "route 306 across ohr sameach", "on 306 across ohr sameach", "on 306 across ohr sameach (corner viola road)", "on 306 corner viola road across ohr sameach"], lat: 41.1353, lng: -74.0666, passengerLabel: "Route 306 & Viola Road" },
    // OSM reverse/Overpass data at the existing stop coordinate identifies Viola Road
    // and NY 306 within the stop vicinity (queried 2026-09-20):
    // https://www.openstreetmap.org/?mlat=41.135307&mlon=-74.066505#map=18/41.135307/-74.066505
    { matches: ["ohr sameach"], lat: 41.135307015448, lng: -74.066505019584, passengerLabel: "Route 306 & Viola Road" },
    { matches: ["viola corner union", "viola road corner union", "viola rd. corner union", "viola road & union road", "union and viola", "starts on viola road corner union road 15 minutes prior to schedule time", "starts by viola rd. corner union rd. 15 min. prior to schedule time", "15 minutes before schedule time - on viola road corner union road"], lat: 41.1323157, lng: -74.0542874, passengerLabel: "Viola Road & Union Road" },
    { matches: ["maple avenue in front of the nursing home", "maple ave in front of the nursing home", "picks up on schedule time on maple ave in front of the nursing home", "at scheduled time - on maple avenue in front of the nursing home"], lat: 41.1158632, lng: -74.067946, passengerLabel: "Maple Avenue" },
    { matches: ["route 59 corner west street"], lat: 41.1082, lng: -74.0529, passengerLabel: "Route 59 & West Street" },
    { matches: ["old nyack turnpike across south madison", "on old nyack turnpike across south madison (chaya sarah hall)", "on old nyack tpk corner s madison (chaya sarah hall)"], lat: 41.101364, lng: -74.047608, passengerLabel: "Old Nyack Turnpike & South Madison Avenue" },
    { matches: ["melnick corner robert pitt"], lat: 41.111017, lng: -74.064979, passengerLabel: "Melnick Drive & Robert Pitt Drive" },
    { matches: ["robert pitt corner route 59", "route 59 corner robert pitt", "robert pitt road corner route 59 side of monsey hub", "robert pitt corner route 59 side of monsey hub"], lat: 41.107788, lng: -74.064541, passengerLabel: "Robert Pitt Drive & Route 59" },
    { matches: ["route 59 in front of frankel", "route 59 in front of frankels shoes"], lat: 41.107307, lng: -74.06696, passengerLabel: "Frankel's Shoes — Route 59" },
    { matches: ["route 59 corner saddle river"], lat: 41.107257, lng: -74.069563, passengerLabel: "Route 59 & Saddle River Road" },
    { matches: ["route 59 corner augusta"], lat: 41.108059, lng: -74.075153, passengerLabel: "Route 59 & Augusta Avenue" },
    { matches: ["route 59 corner bates", "route 59 corner bates (monsey glatt)"], lat: 41.108961, lng: -74.083219, passengerLabel: "Route 59 & Bates Drive" },
    { matches: ["route 59 corner college"], lat: 41.110139, lng: -74.089914, passengerLabel: "Route 59 & College Road" },
    { matches: ["route 59 corner n airmont"], lat: 41.112291, lng: -74.114251, passengerLabel: "Route 59 & North Airmont Road" },
    { matches: ["new square"], lat: 41.1405394, lng: -74.0352229, passengerLabel: "New Square" },
  ] : areaId === 3 ? [
    // Current MTA bus-stop coordinates from the New York State MTA Bus Stops dataset.
    { matches: ["along 50th st", "18th ave & 50th", "18th avenue & 50th"], lat: 40.62793, lng: -73.981252, passengerLabel: "18th Avenue & 50th Street" }, // 300814
    // Directional B11 drop-off poles from the same dataset. These catalog entries
    // are intentionally not aliases for the rider-confirmed 49th Street pickup route.
    { matches: ["50th street & fort hamilton parkway"], lat: 40.637656, lng: -73.998083, passengerLabel: "50th Street & Fort Hamilton Parkway" }, // 301173
    { matches: ["50th street & 11th avenue"], lat: 40.636887, lng: -73.996815, passengerLabel: "50th Street & 11th Avenue" }, // 301174
    { matches: ["50th street & new utrecht avenue"], lat: 40.635485, lng: -73.994491, passengerLabel: "50th Street & New Utrecht Avenue" }, // 301175
    { matches: ["50th street & 13th avenue"], lat: 40.634173, lng: -73.992311, passengerLabel: "50th Street & 13th Avenue" }, // 307619
    { matches: ["50th street & 14th avenue"], lat: 40.632924, lng: -73.990247, passengerLabel: "50th Street & 14th Avenue" }, // 301177
    { matches: ["50th street & 15th avenue"], lat: 40.631556, lng: -73.987988, passengerLabel: "50th Street & 15th Avenue" }, // 301178
    { matches: ["50th street & 16th avenue"], lat: 40.630239, lng: -73.985805, passengerLabel: "50th Street & 16th Avenue" }, // 301179
    { matches: ["50th street & 17th avenue"], lat: 40.62874, lng: -73.983327, passengerLabel: "50th Street & 17th Avenue" }, // 301180
    { matches: ["50th street & 18th avenue — drop-off"], lat: 40.627499, lng: -73.981263, passengerLabel: "50th Street & 18th Avenue — drop-off" }, // 306965
    { matches: ["18th ave & 49th", "18th avenue & 49th", "49th street & 18th avenue", "49th st & 18th ave"], lat: 40.628542, lng: -73.981288, passengerLabel: "18th Avenue & 49th Street" }, // 301286, Lakewood only
    { matches: ["17th ave & 49th", "17th avenue & 49th"], lat: 40.62978, lng: -73.983334, passengerLabel: "17th Avenue & 49th Street" }, // 301287
    { matches: ["16th ave & 49th", "16th avenue & 49th"], lat: 40.631241, lng: -73.985751, passengerLabel: "16th Avenue & 49th Street" }, // 301288
    { matches: ["15th ave & 49th", "15th avenue & 49th"], lat: 40.632558, lng: -73.988008, passengerLabel: "15th Avenue & 49th Street" }, // 301289
    { matches: ["14th ave & 49th", "14th avenue & 49th"], lat: 40.633931, lng: -73.990207, passengerLabel: "14th Avenue & 49th Street" }, // 301290
    { matches: ["13th ave & 49th", "13th avenue & 49th"], lat: 40.63529, lng: -73.992473, passengerLabel: "13th Avenue & 49th Street" }, // 306943
    { matches: ["12th ave & 49th", "12th avenue & 49th"], lat: 40.636566, lng: -73.994628, passengerLabel: "12th Avenue & 49th Street" }, // 301292
    { matches: ["11th ave & 49th", "11th avenue & 49th"], lat: 40.637898, lng: -73.996775, passengerLabel: "11th Avenue & 49th Street" }, // 301293
    { matches: ["fort hamilton pkwy & 49th", "fort hamilton parkway & 49th"], lat: 40.638943, lng: -73.998559, passengerLabel: "Fort Hamilton Parkway & 49th Street" }, // 301295
  ] : areaId === 4 ? [
    { matches: ["bedford avenue & wallabout", "bedford ave & wallabout"], lat: 40.699718, lng: -73.957196, passengerLabel: "Bedford Avenue & Wallabout Street" },
    { matches: ["bedford avenue & hewes", "bedford ave & hewes", "613 bedford"], lat: 40.702845, lng: -73.959584, passengerLabel: "Bedford Avenue & Hewes Street" }, // MTA 303425
    { matches: ["bedford avenue & wilson", "bedford ave & wilson", "between wilson and taylor"], lat: 40.7053505, lng: -73.958891, passengerLabel: "Bedford Avenue & Wilson Street" },
    { matches: ["bedford avenue & taylor", "bedford ave & taylor"], lat: 40.705825, lng: -73.962904, passengerLabel: "Bedford Avenue & Taylor Street" }, // MTA 303427
  ] : areaId === 5 ? [
    { matches: ["34th street & 9th", "34th st & 9th", "9th avenue & 34th", "9th ave & 34th"], lat: 40.753106, lng: -73.995857, passengerLabel: "B&H — 34th Street & 9th Avenue" }, // MTA 401818
    { matches: ["5th avenue & 47th", "5th ave & 47th", "on 5th ave corner 47th street (576 5th ave)"], lat: 40.756592, lng: -73.978751 }, // MTA 400133
    { matches: ["5th avenue & 46th", "5th ave & 46th"], lat: 40.756156, lng: -73.979047, passengerLabel: "5th Avenue & 46th Street" }, // MTA 400516
    { matches: ["5th avenue & 45th", "5th ave & 45th"], lat: 40.754934, lng: -73.980691, passengerLabel: "5th Avenue & 45th Street" },
    { matches: ["5th avenue & 42nd", "5th ave & 42nd", "on 42nd corner 5th (front of zara)"], lat: 40.753348, lng: -73.981034 }, // MTA 400135
    { matches: ["5th avenue & 23rd", "5th ave & 23rd"], lat: 40.741112, lng: -73.989723, passengerLabel: "5th Avenue & 23rd Street" },
    { matches: ["7th avenue & 42nd", "7th ave & 42nd", "on 42nd corner 7th (new victory theater)"], lat: 40.756311, lng: -73.987403 }, // MTA 405549
    { matches: ["8th avenue & 42nd", "8th ave & 42nd", "on 42nd corner 8th (across port authority)"], lat: 40.757191, lng: -73.989904 }, // MTA 403239
  ] : areaId === 6 ? [
    { matches: ["trinity place & exchange", "trinity pl & exchange"], lat: 40.707875, lng: -74.012754 }, // MTA 903095, Trinity Pl/Rector St
    { matches: ["6th avenue & spring", "6th ave & spring"], lat: 40.725672, lng: -74.003915 }, // MTA 404895
    { matches: ["6th avenue & 23rd", "6th ave & 23rd"], lat: 40.743027, lng: -73.992644 }, // MTA 400929
  ] : areaId === 11 ? [
    { matches: ["34th street & 9th", "34th st & 9th", "9th avenue & 34th", "9th ave & 34th"], lat: 40.753106, lng: -73.995857, passengerLabel: "B&H — 34th Street & 9th Avenue" }, // MTA 401818
  ] : areaId === 7 ? [
    { matches: ["westgate shopping center", "kosher west", "westgate shopping center in front of kosher west sign"], lat: 40.087001, lng: -74.254855, passengerLabel: "Westgate Shopping Center" },
    { matches: ["miller rd corner new central", "miller road & new central"], lat: 40.092315, lng: -74.243562, passengerLabel: "Miller Road & New Central Avenue" },
    { matches: ["14th at corner case", "14th street & case"], lat: 40.102879, lng: -74.233771, passengerLabel: "14th Street & Case Road" },
    { matches: ["forest ave corner 9th", "forest avenue & 9th"], lat: 40.098521, lng: -74.22004, passengerLabel: "Forest Avenue & 9th Street" },
    { matches: ["kennedy corner squankum", "squankum corner kennedy", "kennedy boulevard & squankum"], lat: 40.10588, lng: -74.204557, passengerLabel: "Kennedy Boulevard & Squankum Road" },
    { matches: ["cross street corner granite", "cross street & granite", "cross street corner granite drive (satmer)", "cross street corner granite drive (satmar)"], lat: 40.055448, lng: -74.222459, passengerLabel: "Cross Street & Granite Drive" },
    { matches: ["river ave in front of evergreen", "river ave across evergreen"], lat: 40.063119, lng: -74.218367, passengerLabel: "Evergreen — 945 River Avenue" },
    { matches: ["madison ave corner 9th", "madison avenue & 9th"], lat: 40.098761, lng: -74.217973, passengerLabel: "Madison Avenue & 9th Street" },
    { matches: ["clifton ave corner 10th", "clifton avenue & 10th"], lat: 40.099945, lng: -74.216091, passengerLabel: "Clifton Avenue & 10th Street" },
    { matches: ["river ave in front of kimball", "kimball hospital", "river ave in front of kimball hospital"], lat: 40.073346, lng: -74.219225, passengerLabel: "Monmouth Medical Center — 600 River Avenue" },
  ] : areaId === 8 ? [
    { matches: ["kennedy boulevard & squankum", "squankum and kennedy", "squankum corner kennedy"], lat: 40.10588, lng: -74.204557, passengerLabel: "Kennedy Boulevard & Squankum Road" },
  ] : areaId === 9 ? [
    { matches: ["coney island avenue & avenue n", "coney island and ave. n", "coney island corner ave. n"], lat: 40.6152, lng: -73.963416, passengerLabel: "Coney Island Avenue & Avenue N" },
    { matches: ["coney island avenue & avenue j", "coney island and ave. j", "coney island corner ave. j", "conery island corner ave. j"], lat: 40.624758, lng: -73.965225, passengerLabel: "Coney Island Avenue & Avenue J" },
  ] : areaId === 10 ? [
    { matches: ["bais hachaim", "10 minutes before schedule - at the bais hachaim", "bais hachaim 10 minutes before schedule"], lat: 41.346243, lng: -74.175137, passengerLabel: "Bais Hachaim — 82 Raywood Drive" },
    { matches: ["bais medrash", "bais hamedresh", "at schedule time - at the bais medrash", "at schedule time - bais medrash"], lat: 41.340991, lng: -74.167984, passengerLabel: "Bais Medrash bus shelter" },
    { matches: ["forest corner gorlitz", "forest road & gorlitz"], lat: 41.344647, lng: -74.168514, passengerLabel: "Forest Road & Gorlitz Court" },
    { matches: ["acers corner krolla", "acres corner krolla"], lat: 41.346115, lng: -74.167286, passengerLabel: "Acres Road & Krolla Drive" },
    { matches: ["acers corner israel zupnik", "acres corner israel zupnik"], lat: 41.342356, lng: -74.159973, passengerLabel: "Acres Road & Israel Zupnick Drive" },
    { matches: ["bakertown corner i zupnik", "bakertown corner i zupnik corner", "bakertown road & israel zupnick"], lat: 41.336507, lng: -74.160623, passengerLabel: "Bakertown Road & Israel Zupnick Drive" },
    { matches: ["schunnemunk corner seven springs"], lat: 41.352276, lng: -74.165538, passengerLabel: "Schunnemunk Road & Seven Springs Mountain Road" },
    { matches: ["quickway corner van buren"], lat: 41.337984, lng: -74.168508, passengerLabel: "Quickway Road & Van Buren Drive" },
    { matches: ["kiryas joel park & ride", "park and ride", "park & ride"], lat: 41.332997, lng: -74.16221, passengerLabel: "Kiryas Joel Park & Ride" },
    { matches: ["garfield road bus stop", "garfield"], lat: 41.340556, lng: -74.168887, passengerLabel: "Garfield Road bus stop" },
  ] : [];
  const match = aliases.find((alias) => alias.matches.some((phrase) => exact(phrase)));
  return match ? {
    lat: match.lat,
    lng: match.lng,
    label: line,
    passengerLabel: "passengerLabel" in match ? String(match.passengerLabel) : undefined,
  } : null;
}

type StopOverrideRow = typeof scheduleStopOverridesTable.$inferSelect;

async function geocodeOfficialStop(line: string, areaId: number, stopOverrides?: StopOverrideRow[]) {
  const verified = knownStop(line, areaId) ?? (areaId === 0
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      .map(candidate => ({ areaId: candidate, point: knownStop(line, candidate) }))
      .find(candidate => candidate.point)?.point ?? null
    : null);
  const resolvedAreaId = knownStop(line, areaId)
    ? areaId
    : areaId === 0
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        .find(candidate => Boolean(knownStop(line, candidate))) ?? areaId
      : areaId;
  if (verified) {
    const candidates = [scheduleStopKey(resolvedAreaId, line), scheduleStopKey(
      resolvedAreaId,
      "passengerLabel" in verified && verified.passengerLabel ? String(verified.passengerLabel) : line,
    )];
    const overrides = stopOverrides
      ? stopOverrides.filter(row => candidates.includes(row.key))
      : await db.select().from(scheduleStopOverridesTable)
        .where(inArray(scheduleStopOverridesTable.key, candidates));
    const override = overrides.find(row => row.suppressed) ?? overrides[0];
    if (override?.suppressed) {
      throw Object.assign(new Error("Schedule stop suppressed by administrator."), {
        code: "SCHEDULE_STOP_SUPPRESSED",
      });
    }
    return override
      ? { ...verified, lat: override.lat, lng: override.lng, address: override.address ?? (
        "passengerLabel" in verified && verified.passengerLabel ? String(verified.passengerLabel) : line
      ) }
      : verified;
  }
  const directKey = scheduleStopKey(areaId, line);
  const [administratorSource] = stopOverrides
    ? stopOverrides.filter(row => row.key === directKey)
    : await db.select().from(scheduleStopOverridesTable)
      .where(eq(scheduleStopOverridesTable.key, directKey)).limit(1);
  if (administratorSource?.suppressed) {
    throw Object.assign(new Error("Schedule stop suppressed by administrator."), {
      code: "SCHEDULE_STOP_SUPPRESSED",
    });
  }
  if (administratorSource) {
    return {
      lat: administratorSource.lat,
      lng: administratorSource.lng,
      label: line,
      address: administratorSource.address ?? administratorSource.canonicalLabel,
      administratorVerified: true,
    };
  }
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) throw new Error(`No coordinates are available for "${line}"`);
  const serviceArea = SERVICE_AREAS[areaId];
  const query = serviceArea ? `${line}, ${serviceArea.searchArea}` : `${line}, New York`;
  const params = new URLSearchParams({
    key: apiKey,
    limit: "5",
    countrySet: "US",
    language: "en-US",
    view: "Unified",
  });
  if (serviceArea) {
    params.set("lat", String(serviceArea.lat));
    params.set("lon", String(serviceArea.lng));
    params.set("radius", "40234");
  }
  const response = await fetch(
    `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?${params}`,
    {
      headers: { "User-Agent": "MonseyTrailsCoachDisplay/1.0 schedule fallback" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error(`Coordinates could not be found for "${line}"`);
  const body = await response.json() as {
    results?: Array<{
      position?: { lat?: number; lon?: number };
      address?: { freeformAddress?: string };
    }>;
  };
  const result = body.results?.find(candidate =>
    Number.isFinite(candidate.position?.lat)
    && Number.isFinite(candidate.position?.lon)
    && (!serviceArea || milesBetween(
      { lat: candidate.position!.lat!, lng: candidate.position!.lon! },
      serviceArea,
    ) <= 25));
  if (!result?.position || !Number.isFinite(result.position.lat) || !Number.isFinite(result.position.lon)) {
    throw new Error(`Coordinates could not be found for "${line}"`);
  }
  return {
    lat: result.position.lat!,
    lng: result.position.lon!,
    label: line,
    address: result.address?.freeformAddress ?? line,
    administratorVerified: false,
  };
}

/** Source labels which have passed the audited resolver and are available to administrators
 * even before an override exists. The resolver remains the authority for variants. */
export const INTEGRATED_SCHEDULE_STOPS = [
  [1, "Jackson Avenue & Washington Avenue"], [1, "New Square"],
  [2, "Route 59 & Route 45"], [2, "Amazing Savings"], [2, "Park & Ride"],
  [2, "Maple Avenue & Route 45"], [2, "Maple Avenue & Twin Avenue"],
  [2, "Maple Avenue & Decatur Avenue"], [2, "Route 59 & Remsen Avenue"],
  [2, "Grove Street & Saddle River Road"], [2, "Route 306 & Maple Avenue"],
  [2, "Monsey Boulevard — bus shelter"], [2, "Monsey Boulevard & Maple Avenue"],
  [2, "Maple Avenue in front of the nursing home"], [2, "Route 306 & Wiener Drive"], [2, "Route 306 & Viola Road"],
  [2, "Viola Road & Union Road"], [2, "Route 59 & West Street"],
  [3, "18th Avenue & 50th Street"], [3, "18th Avenue & 49th Street"],
  [3, "50th Street & Fort Hamilton Parkway"], [3, "50th Street & 11th Avenue"],
  [3, "50th Street & New Utrecht Avenue"], [3, "50th Street & 13th Avenue"],
  [3, "50th Street & 14th Avenue"], [3, "50th Street & 15th Avenue"],
  [3, "50th Street & 16th Avenue"], [3, "50th Street & 17th Avenue"],
  [3, "50th Street & 18th Avenue — drop-off"],
  [3, "17th Avenue & 49th Street"], [3, "16th Avenue & 49th Street"],
  [3, "15th Avenue & 49th Street"], [3, "14th Avenue & 49th Street"],
  [3, "13th Avenue & 49th Street"], [3, "12th Avenue & 49th Street"],
  [3, "11th Avenue & 49th Street"], [3, "Fort Hamilton Parkway & 49th Street"],
  [4, "Bedford Avenue & Wallabout Street"], [4, "Bedford Avenue & Hewes Street"],
  [4, "Bedford Avenue & Wilson Street"], [4, "Bedford Avenue & Taylor Street"], [5, "B&H"],
  [5, "5th Avenue & 47th Street"], [5, "5th Avenue & 45th Street"],
  [5, "5th Avenue & 46th Street"],
  [5, "5th Avenue & 42nd Street"], [5, "5th Avenue & 23rd Street"],
  [5, "7th Avenue & 42nd Street"], [5, "8th Avenue & 42nd Street"],
  [6, "Trinity Place & Exchange"], [6, "6th Avenue & Spring"],
  [6, "6th Avenue & 23rd Street"], [7, "Westgate Shopping Center"],
  [7, "Miller Road & New Central Avenue"], [7, "14th Street & Case Road"],
  [7, "Forest Avenue & 9th Street"], [7, "Kennedy Boulevard & Squankum Road"],
  [7, "Cross Street & Granite Drive"], [7, "River Ave in front of Evergreen"],
  [7, "Madison Avenue & 9th Street"], [7, "Clifton Avenue & 10th Street"],
  [7, "River Ave in front of Kimball"],
  [7, "Kennedy Boulevard & Squankum Road"], [8, "Kennedy Boulevard & Squankum Road"],
  [9, "Coney Island Avenue & Avenue N"], [9, "Coney Island Avenue & Avenue J"],
  [10, "Bais Hachaim"], [10, "Bais Medrash"],
  [10, "Forest corner Gorlitz"], [10, "Acres corner Krolla"],
  [10, "Acres corner Israel Zupnik"], [10, "Bakertown corner I Zupnik"],
  [10, "Schunnemunk corner Seven Springs"],
  [10, "Quickway Road & Van Buren Drive"],
  [10, "Kiryas Joel Park & Ride"], [10, "Garfield Road bus stop"],
  [11, "B&H"],
  [2, "Route 59 at Amazing Savings"], [2, "Maple Ave corner Phillies"],
  [2, "Monsey Boulevard & West Central Avenue"], [2, "Route 306 & Wiener Drive"],
  [2, "Viola Road & Union Road"], [2, "Route 59 & West Street"],
  [2, "Old Nyack Turnpike across South Madison"],
  [2, "Melnick corner Robert Pitt"], [2, "Robert Pitt corner Route 59"],
  [2, "Route 59 in front of Frankel"], [2, "Route 59 corner Saddle River"],
  [2, "Route 59 & Augusta Avenue"], [2, "Route 59 & Bates Drive"],
  [2, "Route 59 & College Road"], [2, "Route 59 corner N Airmont"],
] as const;

export type PublishedStopCategory = "pickup" | "dropoff" | "both";

/**
 * Default stop roles from the uploaded Monsey Trails Tishrei '26 schedule,
 * pages 1-2, effective September 11-October 8, 2026. These are catalog roles,
 * not permission to add a stop to every route: P, Q, R and routes 7/8 remain
 * route-dependent in the resolver. Stops outside this publication retain the
 * previous "both" default until similarly audited.
 */
const TISHREI_2026_STOP_CATEGORIES = new Map<string, PublishedStopCategory>([
  [scheduleStopKey(1, "New Square"), "both"],
  [scheduleStopKey(2, "Route 59 & Route 45"), "both"],
  [scheduleStopKey(2, "Maple Avenue & Route 45"), "dropoff"],
  [scheduleStopKey(2, "Maple Avenue & Twin Avenue"), "dropoff"],
  [scheduleStopKey(2, "Maple Avenue & Decatur Avenue"), "dropoff"],
  [scheduleStopKey(2, "Route 59 & Remsen Avenue"), "dropoff"],
  [scheduleStopKey(2, "Grove Street & Saddle River Road"), "dropoff"],
  [scheduleStopKey(2, "Route 306 & Maple Avenue"), "dropoff"],
  [scheduleStopKey(2, "Amazing Savings"), "pickup"],
  [scheduleStopKey(2, "Monsey Park & Ride"), "both"],
  [scheduleStopKey(2, "Monsey Boulevard — bus shelter"), "both"],
  [scheduleStopKey(2, "Monsey Boulevard & Maple Avenue"), "dropoff"],
  [scheduleStopKey(2, "Maple Avenue"), "pickup"],
  [scheduleStopKey(2, "Route 306 & Wiener Drive"), "both"],
  [scheduleStopKey(2, "Route 306 & Viola Road"), "both"],
  [scheduleStopKey(2, "Viola Road & Union Road"), "both"],
  [scheduleStopKey(2, "Route 59 & West Street"), "pickup"],
  [scheduleStopKey(2, "Route 59 at Amazing Savings"), "dropoff"],
  [scheduleStopKey(2, "Maple Avenue & Phyllis Terrace"), "dropoff"],
  [scheduleStopKey(2, "Monsey Boulevard & West Central Avenue"), "both"],
  [scheduleStopKey(2, "Old Nyack Turnpike & South Madison Avenue"), "both"],
  [scheduleStopKey(2, "Melnick Drive & Robert Pitt Drive"), "pickup"],
  [scheduleStopKey(2, "Robert Pitt Drive & Route 59"), "dropoff"],
  [scheduleStopKey(2, "Route 59 & Augusta Avenue"), "dropoff"],
  [scheduleStopKey(3, "18th Avenue & 50th Street"), "both"],
  [scheduleStopKey(3, "50th Street & Fort Hamilton Parkway"), "dropoff"],
  [scheduleStopKey(3, "50th Street & 11th Avenue"), "dropoff"],
  [scheduleStopKey(3, "50th Street & New Utrecht Avenue"), "dropoff"],
  [scheduleStopKey(3, "50th Street & 13th Avenue"), "dropoff"],
  [scheduleStopKey(3, "50th Street & 14th Avenue"), "dropoff"],
  [scheduleStopKey(3, "50th Street & 15th Avenue"), "dropoff"],
  [scheduleStopKey(3, "50th Street & 16th Avenue"), "dropoff"],
  [scheduleStopKey(3, "50th Street & 17th Avenue"), "dropoff"],
  [scheduleStopKey(3, "50th Street & 18th Avenue — drop-off"), "dropoff"],
  [scheduleStopKey(3, "18th Avenue & 49th Street"), "pickup"],
  [scheduleStopKey(3, "17th Avenue & 49th Street"), "pickup"],
  [scheduleStopKey(3, "16th Avenue & 49th Street"), "pickup"],
  [scheduleStopKey(3, "15th Avenue & 49th Street"), "pickup"],
  [scheduleStopKey(3, "14th Avenue & 49th Street"), "pickup"],
  [scheduleStopKey(3, "13th Avenue & 49th Street"), "pickup"],
  [scheduleStopKey(3, "12th Avenue & 49th Street"), "pickup"],
  [scheduleStopKey(3, "11th Avenue & 49th Street"), "pickup"],
  [scheduleStopKey(3, "Fort Hamilton Parkway & 49th Street"), "pickup"],
  [scheduleStopKey(4, "Bedford Avenue & Wallabout Street"), "both"],
  [scheduleStopKey(4, "Bedford Avenue & Hewes Street"), "both"],
  [scheduleStopKey(4, "Bedford Avenue & Wilson Street"), "both"],
  [scheduleStopKey(4, "Bedford Avenue & Taylor Street"), "both"],
  [scheduleStopKey(5, "B&H — 34th Street & 9th Avenue"), "both"],
  [scheduleStopKey(5, "5th Avenue & 47th Street"), "pickup"],
  [scheduleStopKey(5, "5th Avenue & 46th Street"), "dropoff"],
  [scheduleStopKey(5, "5th Avenue & 45th Street"), "dropoff"],
  [scheduleStopKey(5, "5th Avenue & 42nd Street"), "both"],
  [scheduleStopKey(5, "5th Avenue & 23rd Street"), "dropoff"],
  [scheduleStopKey(5, "7th Avenue & 42nd Street"), "pickup"],
  [scheduleStopKey(5, "8th Avenue & 42nd Street"), "pickup"],
  [scheduleStopKey(11, "B&H — 34th Street & 9th Avenue"), "both"],
]);

export function publishedStopCategory(
  areaId: number,
  canonicalLabel: string,
): PublishedStopCategory {
  return TISHREI_2026_STOP_CATEGORIES.get(scheduleStopKey(areaId, canonicalLabel)) ?? "both";
}

export function integratedScheduleStops() {
  const stops = INTEGRATED_SCHEDULE_STOPS.map(([areaId, label]) => {
    const point = knownStop(label, areaId);
    return point ? { areaId, areaName: SERVICE_AREAS[areaId].name, sourceLabel: label,
      canonicalLabel: point.passengerLabel ?? label, lat: point.lat, lng: point.lng,
      category: publishedStopCategory(areaId, point.passengerLabel ?? label) } : null;
  }).filter((value): value is NonNullable<typeof value> => Boolean(value));
  return [...new Map(stops.map(stop => [
    scheduleStopKey(stop.areaId, stop.canonicalLabel),
    stop,
  ])).values()];
}

function cookieHeader(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return values.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
}

export async function fetchOfficialSchedule(query: OfficialRunQuery) {
  const key = `${query.line}:${query.origin}:${query.destination}:${query.date}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as ReturnType<typeof normalizeSchedule>;
  const pending = scheduleInFlight.get(key);
  if (pending) return pending;
  const request = (async () => {
    const home = await fetch(`${SOURCE_URL}/`, {
      headers: { "User-Agent": "MonseyTrailsCoachDisplay/1.0 schedule reader" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!home.ok) throw new Error(`schedule homepage returned ${home.status}`);
    const html = await home.text();
    const token = html.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1];
    if (!token) throw new Error("schedule token was not available");
    const upstream = await fetch(`${SOURCE_URL}/ajax/schedule`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Cookie": cookieHeader(home),
        "User-Agent": "MonseyTrailsCoachDisplay/1.0 schedule reader",
        "X-CSRF-TOKEN": token,
      },
      body: JSON.stringify({ ...query, type: "date" }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) throw new Error(`schedule request returned ${upstream.status}`);
    const value = normalizeSchedule(await upstream.json(), query.date);
    if (
      cached
      && authoritativeScheduleFingerprint(cached.value as ReturnType<typeof normalizeSchedule>)
        !== authoritativeScheduleFingerprint(value)
    ) {
      invalidateScheduleDerivedCaches();
    }
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    if (cache.size > JOURNEY_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return value;
  })();
  scheduleInFlight.set(key, request);
  void request.finally(() => {
    if (scheduleInFlight.get(key) === request) scheduleInFlight.delete(key);
  }).catch(() => undefined);
  return request;
}

export function clearOfficialScheduleCachesForTest() {
  cache.clear();
  scheduleInFlight.clear();
  invalidateScheduleDerivedCaches();
}

export async function resolveVerifiedOfficialRun(
  query: { line: number; origin: number; destination: number; date: string },
  runId: string,
  stopOverrides?: StopOverrideRow[],
) {
  const runKey = `${query.date}|${query.line}|${query.origin}|${query.destination}|${runId}`;
  // A repeated journey/details request must still revalidate the authoritative schedule
  // at the same short bound as the public schedule list.
  await fetchOfficialSchedule(query);
  const cacheGeneration = journeyCacheGeneration;
  const cached = stopOverrides ? null : verifiedRunCache.get(runKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const { identity } = await equivalentOfficialRunKeys(query, runId);
  const { schedule, run, canonicalQuery, canonicalRun, shared } = identity;
  const canonicalKey = createOfficialScheduleRunKey(canonicalQuery, runId);
  const localPickupLines = query.origin === 3
    ? auditedBoroParkStopLines(run.pickupDescription, query.line, "pickup") ?? parseStopDescription(run.pickupDescription)
    : auditedRegionalStopLines(run.pickupDescription, query.origin);
  const throughRun = await findManhattanBoroParkThroughRun(query, run);
  const monseyRun = shared
    ? query.origin === 2
      ? run
      : (await fetchOfficialSchedule({ ...query, origin: 2 }).then(candidate => (
        candidate.runs.find((item: { id: string }) => item.id === runId)
      )))
    : null;
  const dropoffStops = throughRun
    ? orderedManhattanBoroParkDropoffs(
      throughRun.manhattanRun.dropoffDescription,
      throughRun.boroParkRun.dropoffDescription,
      query.line,
    )
    : (query.destination === 3
      ? auditedBoroParkStopLines(run.dropoffDescription, query.line, "dropoff") ?? parseStopDescription(run.dropoffDescription)
      : auditedRegionalStopLines(run.dropoffDescription, query.destination))
      .map(line => ({ line, areaId: query.destination, kind: "dropoff" as const }));
  const sourceStops = [
    ...(shared
      ? orderedSharedOriginStopLines(
      canonicalRun.pickupDescription,
      monseyRun?.pickupDescription ?? "",
      "",
    )
      : localPickupLines.map(line => ({ line, areaId: query.origin, kind: "pickup" as const }))),
    ...dropoffStops,
  ];
  if (sourceStops.length === 0 || sourceStops.length > MAX_OFFICIAL_STOPS) {
    throw Object.assign(new Error("This published run does not contain a usable ordered stop list."), { status: 422 });
  }
  const firstPickup = scheduledDepartureInstant(query.date, canonicalRun.firstPickupTime);
  const departure = scheduledDepartureInstant(query.date, run.scheduledTime || run.firstPickupTime);
  const physicalDeparture = earliestPublishedRunDeparture(query.date, canonicalRun);
  const trafficDeparture = firstPickup ?? physicalDeparture;
  const arrival = publishedArrivalInstant(query.date, run.arrivalTime, trafficDeparture);
  const stops: OfficialStop[] = [];
  const unresolved: string[] = [];
  for (const [index, stop] of sourceStops.entries()) {
    try {
      const point = await geocodeOfficialStop(stop.line, stop.areaId, stopOverrides);
      const publishedAt = publishedStopInstant(
        query.date,
        stop.line,
        index,
        sourceStops.length,
        stop.areaId === 2 && monseyRun ? monseyRun : canonicalRun,
      );
      const label = "address" in point && typeof point.address === "string"
        ? point.address
        : formatPassengerStopLabel(stop.line, {
          verifiedLabel: "passengerLabel" in point && typeof point.passengerLabel === "string"
            ? point.passengerLabel : undefined,
        });
      stops.push({
        id: `official-${canonicalKey.replaceAll("|", "-")}-${index + 1}`,
        label,
        rawLabel: stop.line,
        address: label,
        note: extractPassengerStopNote(stop.line, label),
        mapLabel: String.fromCharCode(65 + index),
        lat: point.lat,
        lng: point.lng,
        kind: stop.kind,
        areaId: stop.areaId,
        scheduledAt: publishedAt?.toISOString() ?? null,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "SCHEDULE_STOP_SUPPRESSED") continue;
      unresolved.push(stop.line);
    }
  }
  if (unresolved.length) {
    throw Object.assign(
      new Error(`Coordinates could not be verified for ${unresolved.length} published stop${unresolved.length === 1 ? "" : "s"}.`),
      { status: 422, unresolved },
    );
  }
  const areaKinds = new Map<number, "pickup" | "dropoff">();
  for (const stop of sourceStops) {
    if (!areaKinds.has(stop.areaId) || stop.kind === "pickup") {
      areaKinds.set(stop.areaId, stop.kind);
    }
  }
  const customRows = stopOverrides
    ? stopOverrides.filter(row => row.isCustom && !row.suppressed)
    : await db.select().from(scheduleStopOverridesTable).where(and(
      eq(scheduleStopOverridesTable.isCustom, true),
      eq(scheduleStopOverridesTable.suppressed, false),
    ));
  for (const custom of customRows
    .filter(row => areaKinds.has(Number(row.areaId)))
    .sort((left, right) => left.sequence - right.sequence || left.key.localeCompare(right.key))) {
    const areaId = Number(custom.areaId);
    const kind = areaKinds.get(areaId)!;
    const corrected = repairMissingWesternLongitude(
      { lat: custom.lat, lng: custom.lng },
      stops.filter(stop => stop.areaId === areaId).map(stop => ({ lat: stop.lat, lng: stop.lng })),
    );
    const customStop: OfficialStop = {
      id: `custom-${custom.key}`,
      label: custom.address ?? custom.canonicalLabel,
      rawLabel: custom.sourceLabel,
      address: custom.address ?? custom.canonicalLabel,
      mapLabel: "",
      lat: corrected.lat,
      lng: corrected.lng,
      kind,
      areaId,
      scheduledAt: null,
    };
    const matchingIndexes = stops.flatMap((candidate, index) =>
      candidate.areaId === areaId && candidate.kind === kind ? [index] : []);
    const insertionIndex = kind === "pickup"
      ? (matchingIndexes.at(-1) ?? 0) + 1
      : matchingIndexes.length > 0
        ? matchingIndexes.at(-1)!
        : stops.length;
    stops.splice(insertionIndex, 0, customStop);
  }
  stops.forEach((stop, index) => {
    stop.mapLabel = String.fromCharCode(65 + index);
  });
  const value: ResolvedOfficialRun = {
    runKey,
    routeCode: canonicalRun.routeCode,
    originName: schedule.origin.name,
    destinationName: throughRun ? "Manhattan → Boro Park" : schedule.destination.name,
    serviceDate: query.date,
    scheduledDepartureAt: departure?.toISOString() ?? null,
    scheduledArrivalAt: arrival?.toISOString() ?? null,
    arrivalVerification: publishedArrivalVerification(query.date, run.arrivalTime, trafficDeparture),
    trafficDepartureAt: trafficDeparture?.toISOString() ?? null,
    stops,
  };
  Object.defineProperties(value, {
    canonicalRunKey: { value: canonicalKey, enumerable: false },
    physicalDepartureAt: { value: physicalDeparture?.toISOString() ?? null, enumerable: false },
  });
  if (!stopOverrides && cacheGeneration === journeyCacheGeneration) {
    verifiedRunCache.set(runKey, { expiresAt: Date.now() + VERIFIED_RUN_TTL_MS, value });
    if (verifiedRunCache.size > JOURNEY_CACHE_LIMIT) verifiedRunCache.delete(verifiedRunCache.keys().next().value!);
  }
  return value;
}

// Match wall-clock components in the service timezone, not a fixed UTC offset.
// An ambiguous fall-back time uses the later instant; nonexistent spring times fail closed.
export function scheduledDepartureInstant(date: string, time: string): Date | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match) return null;
  const [, hour, minute, seconds = "00"] = match;
  const publishedHour = Number(hour);
  if (publishedHour > 47 || +minute > 59 || +seconds > 59) return null;
  const calendar = new Date(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime())) return null;
  calendar.setUTCDate(calendar.getUTCDate() + Math.floor(publishedHour / 24));
  const normalizedDate = [
    String(calendar.getUTCFullYear()).padStart(4, "0"),
    String(calendar.getUTCMonth() + 1).padStart(2, "0"),
    String(calendar.getUTCDate()).padStart(2, "0"),
  ].join("-");
  const normalizedHour = String(publishedHour % 24).padStart(2, "0");
  const wall = `${normalizedDate}T${normalizedHour}:${minute}:${seconds}`;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const candidates = [4, 5].map(offset => new Date(`${wall}-0${offset}:00`)).filter(candidate => {
    if (!Number.isFinite(candidate.getTime())) return false;
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` === wall;
  });
  return candidates.at(-1) ?? null;
}

function earliestPublishedRunDeparture(
  date: string,
  run: Pick<ScheduleRun, "firstPickupTime" | "scheduledTime">,
) {
  const values = [run.firstPickupTime, run.scheduledTime]
    .map(value => scheduledDepartureInstant(date, value))
    .filter((value): value is Date => Boolean(value));
  return values.sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
}

export async function resolveOfficialAssignment(runKey: string, stopOverrides?: StopOverrideRow[]) {
  const [date, line, origin, destination, runId, extra] = runKey.split("|");
  const query = validScheduleQuery({ date, line, origin, destination });
  if (!query || !runId || extra || !SERVICE_AREAS[query.origin] || !SERVICE_AREAS[query.destination]) {
    throw new Error("Invalid published run identity.");
  }
  const resolved = await resolveVerifiedOfficialRun(query, runId, stopOverrides);
  const internal = resolved as ResolvedOfficialRun & { canonicalRunKey?: string; physicalDepartureAt?: string | null };
  // A malformed or unavailable published departure remains a warning, not a
  // blocker. The driver's actual start establishes the operational timestamp.
  const scheduledDepartureAt = internal.physicalDepartureAt
    ? new Date(internal.physicalDepartureAt)
    : new Date();
  const scheduledArrivalAt = resolved.scheduledArrivalAt ? new Date(resolved.scheduledArrivalAt) : null;
  if (resolved.stops.length < 2) {
    throw new Error("The published run does not contain a usable ordered stop list.");
  }
  const stops = resolved.stops.map(stop => ({
    id: stop.id,
    address: stop.address ?? stop.rawLabel ?? stop.label,
    lat: stop.lat,
    lng: stop.lng,
    kind: stop.kind,
    ...(stop.note ? { note: stop.note } : {}),
  }));
  return {
    scheduledDepartureAt,
    scheduledArrivalAt,
    canonicalRunKey: internal.canonicalRunKey ?? resolved.runKey,
    equivalentRunKeys: (await equivalentOfficialRunKeys(query, runId)).keys,
    destinationAreaId: resolved.stops.at(-1)!.areaId!,
    destination: { ...stops.at(-1)!, kind: "destination" as const },
    intermediateStops: stops.slice(1, -1),
  };
}

router.get("/public-schedules/monsey-trails", async (req, res): Promise<void> => {
  res.setHeader("cache-control", "no-store");
  const query = validScheduleQuery(req.query as Record<string, unknown>);
  if (!query) {
    res.status(400).json({ error: "Provide a valid line, origin, destination, and YYYY-MM-DD date." });
    return;
  }
  try {
    const schedule = await fetchOfficialSchedule(query);
    const enriched = await enrichScheduleDepartureStatuses(query, schedule);
    const throughRunPairs = new Map<string, ThroughRunPair>();
    await Promise.all((enriched.runs as ScheduleRun[]).map(async run => {
      const pair = await findManhattanBoroParkThroughRun(query, run);
      if (pair) throughRunPairs.set(run.id, pair);
    }));
    const disruptionRunKeys = (enriched.runs as ScheduleRun[]).map(run =>
      createOfficialScheduleRunKey(query, run.id));
    const disruptions = await activeServiceDisruptions(disruptionRunKeys);
    res.json({
      ...enriched,
      runs: enriched.runs.map((run: ScheduleRun & {
        departureStatus: string;
        delayMinutes: number | null;
      }) => {
        const throughRun = throughRunPairs.get(run.id);
        const dropoffDescription = throughRun
          ? [
            passengerStopSummary(throughRun.manhattanRun.dropoffDescription, 5, query.line),
            `Continues to ${passengerStopSummary(throughRun.boroParkRun.dropoffDescription, 3, query.line)}`,
          ].join(" • ")
          : passengerStopSummary(run.dropoffDescription, query.destination, query.line);
        return {
          ...run,
          disruptions: disruptions.filter(notice =>
            notice.officialRunKey === createOfficialScheduleRunKey(query, run.id)),
          pickupDescription: passengerStopSummary(run.pickupDescription, query.origin, query.line),
          dropoffDescription,
          pickupNote: passengerStopNotes(run.pickupDescription, query.origin, query.line),
          dropoffNote: throughRun
            ? [
              passengerStopNotes(throughRun.manhattanRun.dropoffDescription, 5, query.line),
              passengerStopNotes(throughRun.boroParkRun.dropoffDescription, 3, query.line),
            ].filter(Boolean).join(" • ")
            : passengerStopNotes(run.dropoffDescription, query.destination, query.line),
        };
      }),
    });
  } catch (error) {
    req.log.warn({ err: error }, "public schedule refresh failed");
    res.status(502).json({ error: "The official Monsey Trails schedule is temporarily unavailable." });
  }
});

router.post("/public-schedules/monsey-trails/stop-preview", async (req, res): Promise<void> => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  const areaId = Number(req.body?.areaId);
  if (label.length < 4 || label.length > 180 || !Number.isInteger(areaId) || !SERVICE_AREAS[areaId]) {
    res.status(400).json({ error: "Choose a valid published stop." });
    return;
  }
  try {
    const point = await geocodeOfficialStop(label, areaId);
    res.json({
      label: "passengerLabel" in point && point.passengerLabel ? point.passengerLabel : point.label,
      lat: point.lat,
      lng: point.lng,
    });
  } catch (error) {
    req.log.warn({ err: error, label, areaId }, "public stop preview lookup failed");
    res.status(404).json({ error: "A verified map location is not available for this stop." });
  }
});

router.post("/public-schedules/monsey-trails/resolve-run", async (req, res): Promise<void> => {
  const query = validScheduleQuery(req.body ?? {});
  const runId = typeof req.body?.runId === "string" ? req.body.runId.trim() : "";
  if (!query || !runId || runId.length > 80 || !SERVICE_AREAS[query.origin] || !SERVICE_AREAS[query.destination]) {
    res.status(400).json({ error: "Choose a valid published run." });
    return;
  }
  try {
    const official = await resolveVerifiedOfficialRun(query, runId);
    const resolved = official.stops.map(stop => ({ ...stop, address: stop.rawLabel ?? stop.label }));
    const destinationArea = SERVICE_AREAS[query.destination];
    const destination = resolved.at(-1) ?? {
      id: `official-${runId}-destination`,
      label: "Destination",
      address: destinationArea.name,
      lat: destinationArea.lat,
      lng: destinationArea.lng,
      kind: "dropoff" as const,
    };
    res.json({
      runId,
      routeCode: official.routeCode,
      origin: { id: query.origin, name: official.originName },
      destination: {
        id: destination.id,
        label: destination.label,
        lat: destination.lat,
        lng: destination.lng,
      },
      points: resolved.map((stop) => ({
        id: stop.id,
        label: stop.label,
        note: stop.note,
        mapLabel: stop.mapLabel,
        lat: stop.lat,
        lng: stop.lng,
        kind: stop.kind,
      })),
      stops: resolved.slice(1, -1).map((stop) => ({
        id: stop.id,
        label: stop.label,
        note: stop.note,
        mapLabel: stop.mapLabel,
        lat: stop.lat,
        lng: stop.lng,
        kind: stop.kind,
      })),
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 422) {
      res.status(status).json({
        error: (error as Error).message,
        ...("unresolved" in (error as object) ? { unresolved: (error as { unresolved: string[] }).unresolved } : {}),
      });
      return;
    }
    req.log.warn({ err: error }, "official run coordinate resolution failed");
    res.status(502).json({ error: "The official route coordinates are temporarily unavailable." });
  }
});

export async function fetchJourneyTraffic(
  cacheKey: string,
  points: Array<{ lat: number; lng: number }>,
  departAt?: string,
) {
  const cached = journeyTrafficCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt <= JOURNEY_TRAFFIC_TTL_MS) {
    return { ...cached.value, stale: false };
  }
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    return cached && Date.now() - cached.createdAt <= JOURNEY_STALE_TTL_MS
      ? { ...cached.value, stale: true }
      : null;
  }
  let inFlight = journeyTrafficInFlight.get(cacheKey);
  if (!inFlight) {
    const generation = journeyCacheGeneration;
    inFlight = (async () => {
      const route = await fetchTrafficAwareRoute(points, apiKey);
      return {
        routeGeometry: route.geometry,
        legDurationSeconds: route.legDurationSeconds,
        updatedAt: new Date().toISOString(),
      };
    })();
    journeyTrafficInFlight.set(cacheKey, inFlight);
    void inFlight.finally(() => {
      if (journeyTrafficInFlight.get(cacheKey) === inFlight) {
        journeyTrafficInFlight.delete(cacheKey);
      }
    }).catch(() => undefined);
    try {
      const value = await inFlight;
      if (generation === journeyCacheGeneration) {
        journeyTrafficCache.set(cacheKey, { createdAt: Date.now(), value });
        if (journeyTrafficCache.size > JOURNEY_CACHE_LIMIT) journeyTrafficCache.delete(journeyTrafficCache.keys().next().value!);
      }
      return { ...value, stale: false };
    } catch {
      return cached && Date.now() - cached.createdAt <= JOURNEY_STALE_TTL_MS
        ? { ...cached.value, stale: true }
        : null;
    }
  }
  try {
    const value = await inFlight;
    journeyTrafficCache.set(cacheKey, { createdAt: Date.now(), value });
    if (journeyTrafficCache.size > JOURNEY_CACHE_LIMIT) journeyTrafficCache.delete(journeyTrafficCache.keys().next().value!);
    return { ...value, stale: false };
  } catch {
    return cached && Date.now() - cached.createdAt <= JOURNEY_STALE_TTL_MS
      ? { ...cached.value, stale: true }
      : null;
  }
}

export function invalidateJourneyTrafficCaches() {
  journeyTrafficCache.clear();
  journeyTrafficInFlight.clear();
  journeyCacheGeneration += 1;
}

export const clearJourneyTrafficCachesForTest = invalidateJourneyTrafficCaches;

export async function findExactLiveRun(runKeys: string[]): Promise<LiveTripRow | null> {
  const [row] = await db.select().from(liveTripsTable).where(and(
    inArray(liveTripsTable.officialRunKey, runKeys),
    isNull(liveTripsTable.retiredAt),
  )).orderBy(desc(officialAssignmentPriority), desc(liveTripsTable.updatedAt)).limit(1);
  return row ?? null;
}

export async function buildPassengerJourney(
  official: ResolvedOfficialRun,
  exactTrip: LiveTripRow | null,
  now = Date.now(),
  trafficFetcher = fetchJourneyTraffic,
) {
  const live = isFreshLiveJourneyTrip(exactTrip, now);
  // Legacy assignments used origin-local `official-${runId}-${index}` IDs. Reconcile only
  // against stops still persisted on the running trip, without rewriting the row. A legacy
  // New Square assignment that never contained Monsey waypoints therefore remains
  // conservative: it routes only to persisted matches and the destination.
  const journeyStops = exactTrip
    ? appendLiveDestination(
      reconcilePersistedJourneyStopIds(official.stops, exactTrip.intermediateStops),
      exactTrip,
    )
    : official.stops;
  const stopEtas = new Map<string, string>();
  const pickupNotBefore = new Map(journeyStops.flatMap(stop => {
    const scheduled = stop.kind === "pickup" && stop.scheduledAt
      ? new Date(stop.scheduledAt).getTime()
      : NaN;
    return Number.isFinite(scheduled) ? [[stop.id, scheduled] as const] : [];
  }));
  let traffic: (TrafficResult & { stale: boolean }) | null = null;
  if (live && exactTrip) {
    const remaining = remainingOfficialJourneyStops(
      journeyStops,
      exactTrip.intermediateStops.map(stop => stop.id),
    );
    const destinationId = typeof exactTrip.destinationLat === "number"
      && Number.isFinite(exactTrip.destinationLat)
      && typeof exactTrip.destinationLng === "number"
      && Number.isFinite(exactTrip.destinationLng)
      ? `destination:${exactTrip.destinationLat}:${exactTrip.destinationLng}`
      : null;
    // Once a persisted final destination is available, it is the endpoint of
    // the live leg. Do not retain an unpersisted published stop as a second
    // endpoint merely because the generic official-stop fallback selected the
    // last schedule stop.
    const routedRemaining = destinationId
      ? remaining.filter(stop =>
        stop.id === destinationId
        || exactTrip.intermediateStops.some(persisted => persisted.id === stop.id))
      : remaining;
    if (routedRemaining.length) {
      const points = [{ lat: exactTrip.currentLat!, lng: exactTrip.currentLng! }, ...routedRemaining];
      traffic = await trafficFetcher(
        liveTrafficCacheKey(
          official.runKey,
          { lat: exactTrip.currentLat!, lng: exactTrip.currentLng! },
          routedRemaining,
        ),
        points,
      );
      if (traffic) {
        for (const [id, eta] of accumulateJourneyEtas(
          now, routedRemaining.map(stop => stop.id), traffic.legDurationSeconds, false, pickupNotBefore,
        )) stopEtas.set(id, eta);
      }
    }
  } else if (
    official.trafficDepartureAt
    && new Date(official.trafficDepartureAt).getTime() > now
    && journeyStops.length >= 2
  ) {
    traffic = await trafficFetcher(
      `${official.runKey}:forecast:${official.trafficDepartureAt}`,
      journeyStops,
      official.trafficDepartureAt,
    );
    if (traffic) {
      for (const [id, eta] of accumulateJourneyEtas(
        new Date(official.trafficDepartureAt).getTime(),
        journeyStops.map(stop => stop.id),
        traffic.legDurationSeconds,
        true,
        pickupNotBefore,
      )) stopEtas.set(id, eta);
    }
  }
  const unavailableMessage = process.env.TOMTOM_API_KEY
    ? "Traffic estimates are temporarily unavailable."
    : "Traffic estimates are unavailable because the routing service is not configured.";
  const visibility = exactTrip ? locationVisibility(exactTrip, now) : null;
  const message = traffic
    ? traffic.stale ? "Showing the last traffic estimate while live traffic is unavailable." : null
    : visibility === "live"
      ? "Awaiting a fresh live location update."
      : visibility === "ended"
        ? "This journey has ended."
        : unavailableMessage;
  return {
    runKey: official.runKey,
    originName: official.originName,
    destinationName: official.destinationName,
    serviceDate: official.serviceDate,
    scheduledDepartureAt: official.scheduledDepartureAt,
    scheduledArrivalAt: official.scheduledArrivalAt,
    arrivalVerification: official.arrivalVerification ?? (official.scheduledArrivalAt ? "verified" : "unavailable"),
    stops: journeyStops.map(({ rawLabel: _rawLabel, ...stop }, index) => ({
      ...stop,
      estimatedArrivalAt: stopEtas.get(stop.id)
        ?? stop.scheduledAt
        ?? (index === journeyStops.length - 1 ? official.scheduledArrivalAt : null),
    })),
    routeGeometry: traffic?.routeGeometry ?? [],
    trafficUpdatedAt: traffic?.updatedAt ?? null,
    trafficStatus: traffic ? traffic.stale ? "stale" as const : live ? "live" as const : "forecast" as const : "unavailable" as const,
    message,
  };
}

router.post("/public-schedules/monsey-trails/journey", async (req, res): Promise<void> => {
  res.setHeader("cache-control", "no-store");
  const query = validScheduleQuery(req.body ?? {});
  const runId = typeof req.body?.runId === "string" ? req.body.runId.trim() : "";
  if (!query || !runId || runId.length > 80 || !SERVICE_AREAS[query.origin] || !SERVICE_AREAS[query.destination]) {
    res.status(400).json({ error: "Choose a valid published run." });
    return;
  }
  try {
    const official = await resolveVerifiedOfficialRun(query, runId);
    let exactTrip: LiveTripRow | null = null;
    try {
      exactTrip = await findExactLiveRun((await equivalentOfficialRunKeys(query, runId)).keys);
      const physicalDepartureAt = (official as ResolvedOfficialRun & { physicalDepartureAt?: string | null })
        .physicalDepartureAt;
      if (exactTrip && physicalDepartureAt) {
        exactTrip = { ...exactTrip, scheduledDepartureAt: new Date(physicalDepartureAt) };
      }
    } catch (error) {
      req.log.warn({ err: error }, "passenger journey live-run lookup failed");
    }
    res.json({
      ...await buildPassengerJourney(official, exactTrip),
      disruptions: await activeServiceDisruptions(
        (await equivalentOfficialRunKeys(query, runId)).keys,
        new Date(),
        exactTrip?.pairingCode,
      ),
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 422) {
      res.status(status).json({ error: (error as Error).message });
      return;
    }
    req.log.warn({ err: error }, "passenger journey resolution failed");
    res.status(502).json({ error: "The official passenger journey is temporarily unavailable." });
  }
});

export default router;